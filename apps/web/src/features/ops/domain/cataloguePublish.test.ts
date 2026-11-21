import type { CatalogueChange } from '@credalent/jobs';
import { describe, expect, it } from 'vitest';
import type { EvalView } from './catalogueEval.ts';
import { publishBlock } from './cataloguePublish.ts';

// AIV-P2-049 "Scenario Outline: Publish stays disabled until the gate is met": what the card says. The server checks the
// eval and the change again (tests/integration catalogue-publish.test.ts).

const change: CatalogueChange = { group: 'packs', kind: 'added', id: 'insurance', name: 'Insurance', fields: [] };
const passed: EvalView = { status: 'passed', finishedAt: new Date(0), tasks: [], failedCases: [], uncovered: [] };
const REASON = 'Add insurance pack for the pilot client';

describe('publishBlock', () => {
  it.each([
    ['no eval run for this draft', { status: 'not_run' }, REASON, 'evalNotRun'],
    ['the last eval run failed', { ...passed, status: 'failed' }, REASON, 'evalFailed'],
    ['the draft changed after the eval passed', { status: 'stale' }, REASON, 'evalStale'],
    ['a run is running', { status: 'running' }, REASON, 'evalRunning'],
    ['the run could not finish', { status: 'error' }, REASON, 'evalError'],
    ['the reason has 6 characters', passed, 'Add it', 'reason'],
    ['the reason is 10 spaces and a word', passed, '          Add', 'reason'],
  ] as const)('%s: blocked (%s)', (_, evaluation, reason, block) => {
    expect(publishBlock([change], evaluation as EvalView, reason)).toBe(block);
  });

  it('no change blocks first; a passed eval, a reason and a change allow it', () => {
    expect(publishBlock([], passed, REASON)).toBe('noChanges');
    expect(publishBlock([change], passed, 'Ten chars!')).toBeNull();
  });
});
