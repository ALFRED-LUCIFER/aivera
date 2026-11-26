import {
  AiUnavailable,
  BudgetExceeded,
  InvalidCitation,
  MissingIdentifiers,
  SchemaMismatch,
  SourceTooLong,
  UncitedOutput,
} from '@credalent/ai';
import type { Envelope } from '@credalent/db';
import { describe, expect, it, vi } from 'vitest';
import { packSummaryPorts } from './composition.ts';
import { PackReadyV1 } from './contracts/index.ts';

// AIV-P2-011: how the summary job classes each model outcome, with a model that throws. Opaque ids only.
const TASK = 'decisions.summariseMember';
const NOW = new Date('2026-11-17T08:00:00.000Z');
const PACK = '0190d4a2-0000-7000-9000-000000000030';
const JOB = '0190d4a2-0000-7000-9000-000000000010';

function ports(error: Error) {
  const schedule = vi.fn(async (_queue: string, _envelope: Envelope, _at: Date) => '1');
  const built = packSummaryPorts({
    ai: { generateStructured: async () => Promise.reject(error) },
    approvedRubric: async () => null,
    snapshot: async () => null,
    evidence: async () => [],
    identifiersOf: async () => null,
    scheduler: { schedule, cancel: async () => undefined },
    now: () => NOW,
  });
  const summarise = () =>
    built.summarise({
      workspaceId: 'w1',
      sources: [{ id: 'facts', label: 'Assessment', kind: 'document', text: 'Work meets the need.' }],
      identifiers: { names: [], emails: [], phones: [] },
    });
  return { built, schedule, summarise };
}

describe('packSummaryPorts: each model outcome', () => {
  // SAFETY: mutation check: removed the AiUnavailable branch from summarise -> this test failed (it threw)
  it('a model that stays unavailable is no answer: asked again later, never stored unavailable', async () => {
    expect(await ports(new AiUnavailable(TASK, 'timeout')).summarise()).toBe('model_unavailable');
  });

  it('a spent daily budget waits for the reset', async () => {
    expect(await ports(new BudgetExceeded(TASK, 'w1')).summarise()).toBe('budget_exceeded');
  });

  it.each([
    new SchemaMismatch(TASK, ['strengths.0:not_backed']),
    new InvalidCitation(TASK, 'S9', 'unknown source'),
    new UncitedOutput(TASK),
    new SourceTooLong(TASK),
    new MissingIdentifiers(TASK),
  ])('an answer a redelivery cannot change ($name) is stored unavailable', async (error) => {
    expect(await ports(error).summarise()).toBe('failed');
  });

  it('anything else (a bug, a database error) throws, so the message is retried', async () => {
    await expect(ports(new TypeError('bug')).summarise()).rejects.toThrow('bug');
  });

  it("asks again with a new PackReady.v1 for the same pack, at the time given, on the summary job's queue", async () => {
    const { built, schedule } = ports(new AiUnavailable(TASK, 'timeout'));
    const at = new Date('2026-11-17T08:15:00.000Z');
    await built.retryAt('w1', { packId: PACK, jobId: JOB }, at);
    expect(schedule).toHaveBeenCalledWith(
      'assessment',
      expect.objectContaining({
        type: PackReadyV1.type,
        workspaceId: 'w1',
        payload: { packId: PACK, jobId: JOB },
        occurredAt: NOW.toISOString(),
      }),
      at,
    );
  });
});
