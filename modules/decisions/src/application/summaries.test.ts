import type { StoredAssessment } from '@credalent/assessment';
import type { Tx } from '@credalent/db';
import type { EvidenceItemView } from '@credalent/evidence';
import { describe, expect, it, vi } from 'vitest';
import type { DecisionPack, PackMember } from '../domain/pack.ts';
import type { StoredMemberSummary } from '../domain/summary.ts';
import type { PackStore } from './packs.ts';
import { budgetResetAt, summarisePack, type SummaryAnswer, type SummaryPorts } from './summaries.ts';

// AIV-P2-011: the worker job that writes each pack member's cited summary, over faked ports; the database scenarios
// are in tests/integration/src/decisions.test.ts. Synthetic cast and opaque ids only.
const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const [SARA, ARJUN] = [id(20), id(21)] as const;
const PACK = id(30);
const JOB = id(10);
const V2 = id(11);
const REPO = id(40);
const CV = id(41);
const NOW = new Date('2026-11-17T08:00:00.000Z');
const tx = {} as Tx;

const pack: DecisionPack = {
  id: PACK,
  workspaceId: 'w1',
  jobId: JOB,
  rubricVersionId: V2,
  name: 'Round 2 shortlist',
  preparedBy: id(1),
  preparedAt: NOW,
  status: 'ready',
};
const member = (candidateId: string, position: number): PackMember => ({
  workspaceId: 'w1',
  packId: PACK,
  candidateId,
  assessmentId: `a-${candidateId}`,
  backedScore: 68,
  upperBound: 84,
  position,
  addedBy: null,
  addedAt: null,
});
const snapshot = {
  id: 'a-x',
  competencies: [
    {
      competencyId: 'llm',
      weightPercent: 100,
      levelNeeded: 4,
      mandatory: true,
      proven: { level: 4, itemIds: [REPO] },
      claimedLevel: 4,
      claimItemIds: [CV],
    },
  ],
} as unknown as StoredAssessment;
const repo = {
  id: REPO,
  provenance: 'corroborated',
  excerpt: 'authored 412 of 460 commits',
  source: { kind: 'repository', label: 'llm-eval-harness' },
} as unknown as EvidenceItemView;
const cv = {
  id: CV,
  provenance: 'claim',
  excerpt: 'cut cost per request by 38%',
  source: { kind: 'cv', label: 'CV' },
} as unknown as EvidenceItemView;
// The model says "hold"; the snapshot (level 4 of 4 on all the weight) says advance, and the snapshot decides.
const answer: SummaryAnswer = {
  strengths: [
    {
      text: '[CANDIDATE] authored 412 of 460 commits.',
      claim: false,
      citations: [{ sourceId: REPO, quote: '412 of 460' }],
    },
  ],
  risks: [{ text: 'Cost rests on a claim.', claim: true, citations: [{ sourceId: CV, quote: 'cut cost' }] }],
  round1: null,
  recommendation: { action: 'hold', focus: null, citations: [{ sourceId: 'facts', quote: 'Work meets the need' }] },
};

function setup(over: Partial<SummaryPorts> = {}, done: string[] = []) {
  const store = {
    findPack: vi.fn(async () => pack),
    listMembers: vi.fn(async () => [member(SARA, 0), member(ARJUN, 1)]),
    listSummaries: vi.fn(async () => done.map((candidateId) => ({ candidateId }) as StoredMemberSummary)),
    insertSummary: vi.fn<PackStore['insertSummary']>(async () => undefined),
  };
  const ports: SummaryPorts = {
    storeFor: () => store as unknown as PackStore,
    snapshot: vi.fn(async () => snapshot),
    approvedRubric: async () => ({ id: V2, competencies: [{ id: 'llm', name: 'LLM systems in production' }] }),
    evidence: async () => [repo, cv],
    identifiersOf: async () => ({ names: ['Sara Al Qahtani'], emails: [], phones: [] }),
    summarise: vi.fn(async () => ({ promptVersion: 'decisions.summariseMember@2', answer })),
    retryAt: vi.fn(async () => undefined),
    now: () => NOW,
    ...over,
  };
  return { store, ports, run: () => summarisePack(ports, tx, 'w1', PACK) };
}

const stored = (candidateId: string, over: Partial<StoredMemberSummary>): StoredMemberSummary => ({
  workspaceId: 'w1',
  packId: PACK,
  candidateId,
  status: 'unavailable',
  promptVersion: null,
  summary: null,
  createdAt: NOW,
  ...over,
});

describe('summarisePack', () => {
  // SAFETY: mutation check: toSummary kept the model's action -> this test failed ('hold' stored)
  // SAFETY: mutation check: cite() set claim: false for every citation -> this test failed (the CV quote unmarked)
  it('stores each member\'s cited summary once: an item by id and label, a CV quote marked a claim, the facts as "Assessment", the action the snapshot\'s, the candidate never named', async () => {
    const { store, ports, run } = setup();
    await run();
    expect(ports.summarise).toHaveBeenCalledTimes(2);
    const [sources] = vi.mocked(ports.summarise).mock.calls.map(([input]) => input.sources);
    expect(sources?.map((s) => s.id)).toEqual(['facts', REPO, CV]);
    expect(store.insertSummary.mock.calls[0]?.[0]).toEqual(
      stored(SARA, {
        status: 'ready',
        promptVersion: 'decisions.summariseMember@2',
        summary: {
          strengths: [
            {
              text: 'The candidate authored 412 of 460 commits.',
              claim: false,
              citations: [{ itemId: REPO, label: 'llm-eval-harness', quote: '412 of 460', claim: false }],
            },
          ],
          risks: [
            {
              text: 'Cost rests on a claim.',
              claim: true,
              citations: [{ itemId: CV, label: 'CV', quote: 'cut cost', claim: true }],
            },
          ],
          round1: null,
          recommendation: {
            action: 'advance',
            focus: null,
            citations: [{ itemId: null, label: 'Assessment', quote: 'Work meets the need', claim: false }],
          },
        },
      }),
    );
  });

  // SAFETY: mutation check: removed the `done.has` skip -> this test failed (Sara summarised again)
  it('a member already summarised is skipped: no model call, nothing written (a redelivery or a later add)', async () => {
    const { store, ports, run } = setup({}, [SARA]);
    await run();
    expect(ports.snapshot).toHaveBeenCalledTimes(1);
    expect(store.insertSummary.mock.calls.map(([s]) => s.candidateId)).toEqual([ARJUN]);
  });

  // SAFETY: mutation check: stored the answer when summarise returned 'failed' -> this test failed
  it('a rejected or missing answer (a citation outside the snapshot, the model down) is stored unavailable', async () => {
    const { store, run } = setup({ summarise: async () => 'failed' });
    await run();
    expect(store.insertSummary.mock.calls.map(([s]) => s)).toEqual([stored(SARA, {}), stored(ARJUN, {})]);
  });

  it('with another rubric version approved, a missing snapshot or no person, it is unavailable and no model is called', async () => {
    for (const over of [
      { approvedRubric: async () => ({ id: id(99), competencies: [] }) },
      { snapshot: async () => null },
      { identifiersOf: async () => null },
    ] satisfies Partial<SummaryPorts>[]) {
      const { store, ports, run } = setup(over);
      await run();
      expect(ports.summarise).not.toHaveBeenCalled();
      expect(store.insertSummary.mock.calls.map(([s]) => s.status)).toEqual(['unavailable', 'unavailable']);
    }
  });

  it('a spent daily AI budget stores nothing more and asks for the pack again after the reset', async () => {
    const { store, ports, run } = setup({ summarise: async () => 'budget_exceeded' });
    await run();
    expect(store.insertSummary).not.toHaveBeenCalled();
    expect(ports.retryAt).toHaveBeenCalledWith('w1', { packId: PACK, jobId: JOB }, budgetResetAt(NOW));
    expect(budgetResetAt(NOW)).toEqual(new Date('2026-11-18T00:05:00.000Z'));
  });

  // SAFETY: mutation check: summarisePack stored 'model_unavailable' members as unavailable -> this test failed
  it('a model that stays unavailable stores nothing and asks for the pack again 15 minutes later: an outage is no answer', async () => {
    const { store, ports, run } = setup({ summarise: async () => 'model_unavailable' });
    await run();
    expect(store.insertSummary).not.toHaveBeenCalled();
    expect(ports.retryAt).toHaveBeenCalledWith(
      'w1',
      { packId: PACK, jobId: JOB },
      new Date('2026-11-17T08:15:00.000Z'),
    );
  });

  it('a pack that is gone does nothing', async () => {
    const { store, ports, run } = setup();
    store.findPack.mockResolvedValue(null as never);
    await run();
    expect(ports.summarise).not.toHaveBeenCalled();
  });
});
