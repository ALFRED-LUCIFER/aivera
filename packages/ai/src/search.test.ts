import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHUNK_CHARS, chunkText, OVERLAP_CHARS } from './search.ts';

const STEP = CHUNK_CHARS - OVERLAP_CHARS;

describe('chunkText', () => {
  it('keeps a short text as one chunk, and an empty text as none', () => {
    expect(chunkText('Arabic OCR pipeline, public and documented')).toMatchObject([{ index: 0, start: 0, end: 42 }]);
    expect(chunkText('')).toEqual([]);
  });

  it('cuts windows of CHUNK_CHARS that overlap by OVERLAP_CHARS and cover the whole text', () => {
    const text = 'x'.repeat(STEP * 2 + 500);
    expect(chunkText(text).map(({ index, start, end }) => [index, start, end])).toEqual([
      [0, 0, CHUNK_CHARS],
      [1, STEP, STEP + CHUNK_CHARS],
      [2, STEP * 2, text.length],
    ]);
  });

  it('ends at the last full window instead of adding a chunk the previous one already holds', () => {
    expect(chunkText('y'.repeat(CHUNK_CHARS))).toHaveLength(1);
    expect(chunkText('y'.repeat(CHUNK_CHARS + 1)).map((c) => [c.start, c.end])).toEqual([
      [0, CHUNK_CHARS],
      [STEP, CHUNK_CHARS + 1],
    ]);
  });

  it('hashes each chunk with sha256 of exactly its text, so the same text gives the same hash', () => {
    const text = `${'a'.repeat(STEP)}${'b'.repeat(CHUNK_CHARS)}`;
    for (const c of chunkText(text)) {
      expect(c.text).toBe(text.slice(c.start, c.end));
      expect(c.hash).toBe(createHash('sha256').update(c.text).digest('hex'));
    }
    expect(chunkText(text).map((c) => c.hash)).toEqual(chunkText(text).map((c) => c.hash));
  });
});
