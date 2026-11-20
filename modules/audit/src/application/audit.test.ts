import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { PlatformEntry } from '../domain/entry.ts';
import { auditUseCases, type Ports } from './audit.ts';

// AIV-P2-053: the platform log read validates its input before any query and pages by the last entry's id.
const entry = (n: number): PlatformEntry => ({
  id: `0190d4a2-0000-7000-8000-${String(n).padStart(12, '0')}`,
  occurredAt: new Date('2026-11-12T09:30:00Z'),
  actorId: '0190d4a2-0000-7000-8000-00000000a001',
  action: 'ops.console_opened',
  subject: null,
  note: null,
  before: null,
  after: null,
});
const useCases = (readPlatform: Ports['readPlatform']) =>
  auditUseCases({ readPlatform } as Partial<Ports> as Ports).listPlatformEntries;

describe('listPlatformEntries', () => {
  // SAFETY: mutation check: replaced platformEntryQuerySchema.parse with the raw query -> both cases failed (nothing thrown)
  it.each([{ pageSize: 500 }, { cursor: 'not-a-cursor' }])(
    'rejects %o with its zod schema before any query',
    async (query) => {
      const read = vi.fn<Ports['readPlatform']>();
      await expect(useCases(read)(query)).rejects.toThrow(ZodError);
      expect(read).not.toHaveBeenCalled();
    },
  );

  it('a full page carries the last entry id as its cursor; a shorter page carries none', async () => {
    const full = Array.from({ length: 2 }, (_, i) => entry(i + 1));
    expect(await useCases(() => Promise.resolve(full))({ pageSize: 2 })).toEqual({
      entries: full,
      nextCursor: full[1]?.id,
    });
    expect(await useCases(() => Promise.resolve([entry(3)]))({ pageSize: 2 })).toEqual({
      entries: [entry(3)],
      nextCursor: null,
    });
  });
});
