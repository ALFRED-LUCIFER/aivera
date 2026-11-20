// Workspace-scoped embeddings in pgvector (AIV-P0-030): the owning module keeps the text; search.chunk keeps each
// chunk's hash, offsets and vector. Callers authorise the workspace first; RLS keeps every query inside it.
import { createHash } from 'node:crypto';
import { uuidv7, withWorkspace, type Db } from '@credalent/db';
import { and, cosineDistance, eq, sql } from 'drizzle-orm';
import type { AiClient } from './client.ts';
import { chunk } from './infrastructure/schema.ts';

// shortcut: tokens estimated as characters / 4 (no tokenizer installed); 2,000 characters stays far under the model's
// 8,191-token input even for scripts near one token per character. Use a real tokenizer if chunk quality needs it.
export const CHUNK_CHARS = 2000;
export const OVERLAP_CHARS = 200;

export type Chunk = { index: number; start: number; end: number; text: string; hash: string };

/** Fixed windows of CHUNK_CHARS that overlap by OVERLAP_CHARS, each with the sha256 of its text. */
export function chunkText(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (let start = 0; start < text.length; start += CHUNK_CHARS - OVERLAP_CHARS) {
    const end = Math.min(start + CHUNK_CHARS, text.length);
    const part = text.slice(start, end);
    chunks.push({
      index: chunks.length,
      start,
      end,
      text: part,
      hash: createHash('sha256').update(part).digest('hex'),
    });
    if (end === text.length) break;
  }
  return chunks;
}

export type SearchHit = { ownerModule: string; ownerId: string; chunkIndex: number; start: number; end: number };

// The repository's workspace filter, under RLS (two layers, ADR-005).
const ofOwner = (workspaceId: string, ownerModule: string, ownerId: string) =>
  and(eq(chunk.workspaceId, workspaceId), eq(chunk.ownerModule, ownerModule), eq(chunk.ownerId, ownerId));

export function createSearchIndex({ db, ai, now }: { db: Db; ai: AiClient; now: () => Date }) {
  const embed = async (workspaceId: string, value: string) =>
    (await ai.embed({ task: 'search.embed', workspaceId, value })).embedding;

  return {
    /**
     * Chunks, embeds and replaces the owner's vectors. A chunk whose hash the owner already has reuses its vector.
     * Every embed runs before the write, so a failure (AiUnavailable) changes nothing and the caller retries later.
     */
    async indexDocument(workspaceId: string, ownerModule: string, ownerId: string, text: string): Promise<void> {
      const chunks = chunkText(text);
      const known = new Map(
        (
          await withWorkspace(db, workspaceId, (tx) =>
            tx
              .select({ hash: chunk.textHash, embedding: chunk.embedding })
              .from(chunk)
              .where(ofOwner(workspaceId, ownerModule, ownerId)),
          )
        ).map((row) => [row.hash, row.embedding]),
      );
      const rows: (typeof chunk.$inferInsert)[] = [];
      for (const c of chunks) {
        const embedding = known.get(c.hash) ?? (await embed(workspaceId, c.text));
        known.set(c.hash, embedding);
        rows.push({
          id: uuidv7(now().getTime()),
          workspaceId,
          ownerModule,
          ownerId,
          chunkIndex: c.index,
          startOffset: c.start,
          endOffset: c.end,
          textHash: c.hash,
          embedding,
          createdAt: now(),
        });
      }
      // Two concurrent indexings of one owner: the later insert hits chunk_owner_index and throws, so its caller
      // (a queue handler) retries it after the first commits.
      await withWorkspace(db, workspaceId, async (tx) => {
        await tx.delete(chunk).where(ofOwner(workspaceId, ownerModule, ownerId));
        if (rows.length) await tx.insert(chunk).values(rows);
      });
    },

    /** The chunks nearest in meaning to `query`, nearest first, from this workspace only. */
    async searchSimilar(
      workspaceId: string,
      query: string,
      { ownerModule, limit = 10 }: { ownerModule?: string; limit?: number } = {},
    ): Promise<SearchHit[]> {
      const embedding = await embed(workspaceId, query);
      return withWorkspace(db, workspaceId, async (tx) => {
        // The HNSW scan finds neighbours across every workspace before RLS filters them; iterating keeps it going
        // until `limit` rows of this workspace are found, still nearest first (pgvector 0.8).
        // shortcut: no test reaches the HNSW path (a few rows plan a sequential scan); add one with enable_seqscan off
        // when search ranks real volumes (AIV-P1-049).
        await tx.execute(sql`select set_config('hnsw.iterative_scan', 'strict_order', true)`);
        return tx
          .select({
            ownerModule: chunk.ownerModule,
            ownerId: chunk.ownerId,
            chunkIndex: chunk.chunkIndex,
            start: chunk.startOffset,
            end: chunk.endOffset,
          })
          .from(chunk)
          .where(and(eq(chunk.workspaceId, workspaceId), ownerModule ? eq(chunk.ownerModule, ownerModule) : undefined))
          .orderBy(cosineDistance(chunk.embedding, embedding))
          .limit(limit);
      });
    },

    /** Deletes every vector of the owner (a deletion request). */
    async removeOwner(workspaceId: string, ownerModule: string, ownerId: string): Promise<void> {
      await withWorkspace(db, workspaceId, (tx) => tx.delete(chunk).where(ofOwner(workspaceId, ownerModule, ownerId)));
    },
  };
}
