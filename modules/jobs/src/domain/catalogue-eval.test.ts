import { describe, expect, it } from 'vitest';
import { CATALOGUE_V1 } from '../infrastructure/catalogue-v1.fixture.ts';
import { contentHash } from './catalogue-hash.ts';
import {
  draftEvalState,
  EVAL_RUN_TIMEOUT_MS,
  evalAllowsPublish,
  evalKeys,
  isRunning,
  type EvalRun,
} from './catalogue-eval.ts';

// AIV-P2-048: the eval gate on a catalogue draft (ADR-013 point 12). Synthetic catalogue text only.

const draft = CATALOGUE_V1;
const hash = contentHash(draft);
const NOW = new Date('2026-11-21T10:00:00Z');
const result = { uncovered: [], tasks: [] };
const run = (patch: Partial<EvalRun> = {}): EvalRun => ({
  id: '0190d4a2-0000-7000-8000-000000000001',
  version: 2,
  contentHash: hash,
  status: 'passed',
  requestedAt: new Date(NOW.getTime() - 60_000),
  finishedAt: NOW,
  tokens: 1200,
  result,
  ...patch,
});

describe('the content hash', () => {
  it('is stable over field order and ignores version, revision and who saved', () => {
    const reordered = {
      packs: draft.packs.map(({ competencies, hints, retired, label, key }) => ({
        key,
        label,
        retired,
        hints,
        competencies,
      })),
      regions: draft.regions,
      jobTypes: draft.jobTypes,
    };
    expect(contentHash(reordered)).toBe(hash);
    expect(contentHash({ ...draft, version: 9 } as typeof draft)).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes on any field: a label, a retired flag, a competency word, the order of packs', () => {
    const [first, ...rest] = draft.packs;
    if (!first) throw new Error('no pack');
    const variants = [
      { ...draft, packs: [{ ...first, label: { en: 'Telecom networks' } }, ...rest] },
      { ...draft, packs: [{ ...first, retired: true }, ...rest] },
      {
        ...draft,
        packs: [
          { ...first, competencies: first.competencies.map((c, i) => (i === 0 ? { ...c, evidence: 'x' } : c)) },
          ...rest,
        ],
      },
      { ...draft, packs: [...rest, first] },
    ];
    for (const variant of variants) expect(contentHash(variant)).not.toBe(hash);
  });
});

describe('the eval keys', () => {
  it('are the packs and regions not retired', () => {
    const [first, ...rest] = draft.packs;
    if (!first) throw new Error('no pack');
    const keys = evalKeys({ ...draft, packs: [{ ...first, retired: true }, ...rest] });
    expect(keys.domains).toEqual(rest.map((p) => p.key));
    expect(keys.regions).toEqual(draft.regions.filter((r) => !r.retired).map((r) => r.key));
  });
});

describe("the draft's eval state", () => {
  it('Scenario: A passing run is recorded against the draft content', () => {
    const state = draftEvalState(hash, run(), NOW);
    expect(state).toEqual({ status: 'passed', finishedAt: NOW, tokens: 1200, result });
    expect(evalAllowsPublish(state)).toBe(true);
  });

  // SAFETY: mutation check: dropped the contentHash comparison in draftEvalState -> this test failed (state was passed)
  it('Scenario: An edit after the run invalidates it: a pass on other content is stale, never passed', () => {
    const state = draftEvalState('f'.repeat(64), run(), NOW);
    expect(state).toEqual({ status: 'stale', finishedAt: NOW });
    expect(evalAllowsPublish(state)).toBe(false);
  });

  // SAFETY: mutation check: evalAllowsPublish returned true for 'failed' too -> this test failed
  it('a failed, running, lost or never-run eval does not allow publish', () => {
    const states = [
      draftEvalState(hash, run({ status: 'failed' }), NOW),
      draftEvalState(hash, run({ status: 'running', finishedAt: null, result: null }), NOW),
      draftEvalState(hash, run({ status: 'error', result: null }), NOW),
      draftEvalState(hash, null, NOW),
      null,
    ];
    expect(states.map((s) => s?.status ?? null)).toEqual(['failed', 'running', 'error', 'not_run', null]);
    expect(states.some(evalAllowsPublish)).toBe(false);
  });

  it('a run still running past its timeout is lost: it shows as an error and no longer blocks a new run', () => {
    const requestedAt = new Date(NOW.getTime() - EVAL_RUN_TIMEOUT_MS);
    const lost = run({ status: 'running', finishedAt: null, result: null, requestedAt });
    expect(draftEvalState(hash, lost, NOW)).toEqual({ status: 'error', requestedAt });
    expect(isRunning(lost, NOW)).toBe(false);
    expect(isRunning(run({ status: 'running', finishedAt: null, result: null }), NOW)).toBe(true);
    expect(isRunning(null, NOW)).toBe(false);
  });
});
