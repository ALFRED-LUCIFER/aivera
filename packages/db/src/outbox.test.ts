import { pgSchema } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Tx } from './client.ts';
import { enqueue, outboxTable } from './outbox.ts';
import { backoffMs } from './relay.ts';

const EvidenceSubmittedV1 = {
  type: 'EvidenceSubmitted.v1',
  payload: z.strictObject({ evidenceId: z.uuid(), personId: z.uuid() }),
};
const outbox = outboxTable(pgSchema('evidence'));
const W1 = '0190d4a2-0000-7000-8000-000000000001';
const ids = { evidenceId: '0190d4a2-0000-7000-8000-0000000000e1', personId: '0190d4a2-0000-7000-8000-0000000000a1' };

describe('enqueue validates the payload before it writes (AIV-P0-014)', () => {
  // SAFETY: mutation check: removed `event.payload.parse` from enqueue -> this test failed (the row was inserted)
  it('refuses an "evidence.submitted" payload carrying a candidate email, and writes nothing', async () => {
    const insert = vi.fn();
    const tx = { insert } as unknown as Tx;
    const payload = { ...ids, email: 'sara.alqahtani@example.com' };
    const enqueued = enqueue(tx, outbox, EvidenceSubmittedV1, {
      workspaceId: W1,
      payload,
      dedupeKey: 'evidence:1',
      occurredAt: new Date(),
    });
    await expect(enqueued).rejects.toThrow(/email/);
    // The refusal names the field, never its value (AGENTS.md 1.2).
    await expect(enqueued).rejects.not.toThrow(/example\.com/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses an id that is not an opaque id (a name in its place)', async () => {
    const tx = { insert: vi.fn() } as unknown as Tx;
    await expect(
      enqueue(tx, outbox, EvidenceSubmittedV1, {
        workspaceId: W1,
        payload: { ...ids, personId: 'Sara Al Qahtani' },
        dedupeKey: 'evidence:2',
        occurredAt: new Date(),
      }),
    ).rejects.toThrow();
    await expect(
      enqueue(tx, outbox, EvidenceSubmittedV1, {
        workspaceId: W1,
        payload: { ...ids, personId: 'Sara Al Qahtani' },
        dedupeKey: 'evidence:2',
        occurredAt: new Date(),
      }),
    ).rejects.not.toThrow(/Sara/);
    expect(tx.insert).not.toHaveBeenCalled();
  });
});

describe('relay back-off', () => {
  it('doubles from 1 second and stops at 5 minutes', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(9)).toBe(256_000);
    expect(backoffMs(10)).toBe(300_000);
    expect(backoffMs(50)).toBe(300_000);
  });
});
