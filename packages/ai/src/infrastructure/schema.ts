import { tenantPolicy } from '@credalent/db/tenant-policy';
import { halfvec, index, integer, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const search = pgSchema('search');

// Hashes and offsets only: the chunk's text stays in the owning module (AIV-P0-030).
export const chunk = search
  .table(
    'chunk',
    {
      id: uuid().primaryKey(),
      workspaceId: uuid('workspace_id').notNull(),
      // The module that owns the text, and its opaque id for the record (an evidence item, a document).
      ownerModule: text('owner_module').notNull(),
      ownerId: uuid('owner_id').notNull(),
      chunkIndex: integer('chunk_index').notNull(),
      // Character offsets of the chunk in the owner's text.
      startOffset: integer('start_offset').notNull(),
      endOffset: integer('end_offset').notNull(),
      textHash: text('text_hash').notNull(),
      // text-embedding-3-large's 3,072 dimensions (embedding-main, config.ts). halfvec, because HNSW indexes `vector`
      // up to 2,000 dimensions only and `halfvec` up to 4,000.
      embedding: halfvec({ dimensions: 3072 }).notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      unique('chunk_owner_index').on(t.workspaceId, t.ownerModule, t.ownerId, t.chunkIndex),
      index('chunk_embedding_idx').using('hnsw', t.embedding.op('halfvec_cosine_ops')),
      tenantPolicy('chunk_tenant_isolation', t.workspaceId),
    ],
  )
  .enableRLS();
