import { CatalogueError } from '@credalent/jobs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discardCatalogueAction,
  publishCatalogueAction,
  retireDraftEntryAction,
  runCatalogueEvalAction,
  saveDraftCompetencyAction,
  saveDraftHintAction,
  saveDraftJobTypeAction,
  saveDraftPackAction,
  startCatalogueDraft,
} from './editCatalogue.ts';

// AIV-P2-045: the catalogue draft's server actions, called directly. Synthetic operators and catalogue text only.
const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const THEO = '0190d4a2-0000-7000-8000-00000000a002';
const operator = vi.fn<() => Promise<{ userId: string }>>();
const saveCatalogueCompetency = vi.fn(async (..._args: unknown[]) => {});
const saveCataloguePack = vi.fn(async (..._args: unknown[]) => {});
const requestCatalogueEval = vi.fn(async (..._args: unknown[]) => {});
const saveCatalogueHint = vi.fn(async (..._args: unknown[]) => {});
const saveCatalogueJobType = vi.fn(async (..._args: unknown[]) => {});
const publishCatalogueDraft = vi.fn(async (..._args: unknown[]) => {});
const discardCatalogueDraft = vi.fn(async (..._args: unknown[]) => {});
const revalidatePath = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('@/server/operator', () => ({
  platformOperator: () => operator(),
  openCatalogueDraft: async () => {},
  saveCataloguePack: (...args: unknown[]) => saveCataloguePack(...args),
  saveCatalogueCompetency: (...args: unknown[]) => saveCatalogueCompetency(...args),
  saveCatalogueHint: (...args: unknown[]) => saveCatalogueHint(...args),
  saveCatalogueJobType: (...args: unknown[]) => saveCatalogueJobType(...args),
  retireCatalogueEntry: async () => 'retired',
  requestCatalogueEval: (...args: unknown[]) => requestCatalogueEval(...args),
  publishCatalogueDraft: (...args: unknown[]) => publishCatalogueDraft(...args),
  discardCatalogueDraft: (...args: unknown[]) => discardCatalogueDraft(...args),
  operatorName: async (id: string) => (id === THEO ? 'Theo Platform' : null),
}));

const claims = {
  version: 2,
  revision: 4,
  packKey: 'insurance',
  position: null,
  name: 'Claims processing systems',
  meaning: 'Builds and runs the systems that take a claim from notice to payment.',
  evidence: 'Claims workflow code and tests',
  levels: { 1: 'Has fixed a claim bug', 3: 'Owns a claims service', 5: 'Designs claims platforms' },
  appliesTo: ['software_engineering'],
  core: ['software_engineering'],
  levelNeeded: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  operator.mockResolvedValue({ userId: PIA });
});

describe('the catalogue draft server actions', () => {
  it('a save goes to the module and the page is reloaded', async () => {
    expect(await saveDraftCompetencyAction(claims)).toEqual({ ok: true });
    expect(saveCatalogueCompetency).toHaveBeenCalledWith(claims);
    expect(revalidatePath).toHaveBeenCalledWith('/ops/catalogue');
  });

  it('a fairness refusal comes back with the field it goes under', async () => {
    saveCatalogueCompetency.mockRejectedValueOnce(new CatalogueError('fairness_employer', { field: 'name' }));
    expect(await saveDraftCompetencyAction({ ...claims, name: 'Worked at a top insurer' })).toEqual({
      ok: false,
      error: 'fairness_employer',
      field: 'name',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('Scenario: A stale save is refused with the name of who changed the draft', async () => {
    saveCataloguePack.mockRejectedValueOnce(new CatalogueError('stale', { by: THEO }));
    expect(
      await saveDraftPackAction({ version: 2, revision: 4, previousKey: 'insurance', key: 'insurance', label: 'x' }),
    ).toEqual({
      ok: false,
      error: 'stale',
      by: 'Theo Platform',
    });
  });

  it('input outside the schema is refused before the module, naming the field', async () => {
    expect(
      await saveDraftPackAction({ version: 2, revision: 0, previousKey: null, key: 'Insurance!', label: 'x' }),
    ).toEqual({
      ok: false,
      error: 'invalid',
      field: 'key',
    });
    expect(await saveDraftCompetencyAction({ ...claims, type: 'mandatory' })).toEqual({ ok: false, error: 'failed' });
    expect(saveCataloguePack).not.toHaveBeenCalled();
    expect(saveCatalogueCompetency).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed `await platformOperator()` from saveDraftCompetencyAction -> this test failed
  // SAFETY: mutation check: removed `await platformOperator()` from runCatalogueEvalAction -> this test failed
  it('Scenario: Only operators can edit: a non-operator gets 403 and the draft is unchanged', async () => {
    operator.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    for (const action of [
      () => saveDraftCompetencyAction(claims),
      () => saveDraftPackAction({ version: 2, revision: 0, previousKey: null, key: 'insurance', label: 'Insurance' }),
      () => retireDraftEntryAction({ version: 2, revision: 0, entry: 'pack', packKey: 'insurance' }),
      () => startCatalogueDraft(),
      () => runCatalogueEvalAction({ version: 2, revision: 0 }),
      () => saveDraftJobTypeAction(security),
      () => retireDraftEntryAction({ version: 2, revision: 0, entry: 'jobType', jobTypeKey: 'sales' }),
    ])
      await expect(action()).rejects.toThrow('403');
    expect(saveCatalogueCompetency).not.toHaveBeenCalled();
    expect(saveCataloguePack).not.toHaveBeenCalled();
    expect(requestCatalogueEval).not.toHaveBeenCalled();
    expect(saveCatalogueJobType).not.toHaveBeenCalled();
  });
});

describe('Run the eval (AIV-P2-048)', () => {
  it('asks the module for a run on the draft the page showed, and reloads the page', async () => {
    expect(await runCatalogueEvalAction({ version: 2, revision: 4 })).toEqual({ ok: true });
    expect(requestCatalogueEval).toHaveBeenCalledWith({ version: 2, revision: 4 });
    expect(revalidatePath).toHaveBeenCalledWith('/ops/catalogue');
  });

  it('Scenario: Runs do not overlap: a run in progress is refused with its message code', async () => {
    requestCatalogueEval.mockRejectedValueOnce(new CatalogueError('eval_running'));
    expect(await runCatalogueEvalAction({ version: 2, revision: 4 })).toEqual({ ok: false, error: 'eval_running' });
  });

  it('input outside the schema never reaches the module', async () => {
    expect(await runCatalogueEvalAction({ version: 2, revision: 4, operatorId: 'x' })).toEqual({
      ok: false,
      error: 'failed',
    });
    expect(requestCatalogueEval).not.toHaveBeenCalled();
  });
});

// AIV-P2-047: the job type save.
const security = {
  version: 2,
  revision: 4,
  adding: true,
  key: 'security_engineering',
  label: 'Security engineering',
  evidence: 'Threat models, security reviews, fixed vulnerabilities',
  starters: ['Threat modelling', 'Secure code review', 'Incident response', 'Identity and access'],
  position: 2,
};

describe('the job type save action', () => {
  it('a save goes to the module and the page is reloaded', async () => {
    expect(await saveDraftJobTypeAction(security)).toEqual({ ok: true });
    expect(saveCatalogueJobType).toHaveBeenCalledWith(security);
    expect(revalidatePath).toHaveBeenCalledWith('/ops/catalogue');
  });

  it('Scenario Outline: Keys are checked; three starters are refused under the starters', async () => {
    expect(await saveDraftJobTypeAction({ ...security, key: 'Security Engineering' })).toEqual({
      ok: false,
      error: 'invalid',
      field: 'key',
    });
    expect(await saveDraftJobTypeAction({ ...security, starters: security.starters.slice(0, 3) })).toEqual({
      ok: false,
      error: 'invalid',
      field: 'starters',
    });
    expect(saveCatalogueJobType).not.toHaveBeenCalled();
    saveCatalogueJobType.mockRejectedValueOnce(new CatalogueError('key_taken', { field: 'key' }));
    expect(await saveDraftJobTypeAction({ ...security, key: 'software_engineering' })).toEqual({
      ok: false,
      error: 'key_taken',
      field: 'key',
    });
  });

  it('Scenario: Error: a failed save says nothing changed, without the refused text', async () => {
    saveCatalogueJobType.mockRejectedValueOnce(new Error('insert failed: Security engineering'));
    expect(await saveDraftJobTypeAction(security)).toEqual({ ok: false, error: 'failed' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// AIV-P2-046: the save-hint server action.
describe('the save-hint server action', () => {
  const { core: _core, ...fields } = claims;
  const fasah = {
    ...fields,
    packKey: 'logistics_mobility',
    region: 'ksa',
    name: 'FASAH customs integration',
    evidence: 'Integration code and tests against FASAH documents',
    levelNeeded: 2,
  };

  it('a hint goes to the module; a type "mandatory" is refused before it', async () => {
    expect(await saveDraftHintAction(fasah)).toEqual({ ok: true });
    expect(saveCatalogueHint).toHaveBeenCalledWith(fasah);
    expect(await saveDraftHintAction({ ...fasah, type: 'mandatory' })).toEqual({ ok: false, error: 'failed' });
    expect(saveCatalogueHint).toHaveBeenCalledOnce();
  });

  it('the residency refusal comes back under the name', async () => {
    saveCatalogueHint.mockRejectedValueOnce(new CatalogueError('fairness_residency', { field: 'name' }));
    expect(await saveDraftHintAction({ ...fasah, name: 'Must hold a UAE residence visa' })).toEqual({
      ok: false,
      error: 'fairness_residency',
      field: 'name',
    });
  });

  // SAFETY: mutation check: removed `await platformOperator()` from saveDraftHintAction -> this test failed (ok: true)
  it('Scenario: Only operators can edit hints: a non-operator gets 403', async () => {
    operator.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(saveDraftHintAction(fasah)).rejects.toThrow('403');
    await expect(
      retireDraftEntryAction({
        version: 2,
        revision: 0,
        entry: 'regionalHint',
        packKey: 'logistics_mobility',
        region: 'ksa',
        position: 0,
      }),
    ).rejects.toThrow('403');
    expect(saveCatalogueHint).not.toHaveBeenCalled();
  });
});

const REASON = 'Add insurance pack for the pilot client';

describe('Publish or discard the draft (AIV-P2-049)', () => {
  it('publish sends the draft the page showed and the reason; discard the draft; the page reloads', async () => {
    expect(await publishCatalogueAction({ version: 2, revision: 4, reason: REASON })).toEqual({ ok: true });
    expect(publishCatalogueDraft).toHaveBeenCalledWith({ version: 2, revision: 4, reason: REASON });
    expect(await discardCatalogueAction({ version: 2, revision: 4 })).toEqual({ ok: true });
    expect(discardCatalogueDraft).toHaveBeenCalledWith({ version: 2, revision: 4 });
    expect(revalidatePath).toHaveBeenCalledWith('/ops/catalogue');
  });

  it('a reason under 10 characters is refused before the module, under the reason field', async () => {
    expect(await publishCatalogueAction({ version: 2, revision: 4, reason: 'Add it' })).toEqual({
      ok: false,
      error: 'invalid',
      field: 'reason',
    });
    expect(publishCatalogueDraft).not.toHaveBeenCalled();
  });

  it('Scenario: A racing change is refused, not merged: the publish answers stale', async () => {
    publishCatalogueDraft.mockRejectedValueOnce(new CatalogueError('stale', { by: THEO }));
    expect(await publishCatalogueAction({ version: 2, revision: 4, reason: REASON })).toEqual({
      ok: false,
      error: 'stale',
      by: 'Theo Platform',
    });
  });

  // SAFETY: mutation check: removed `await platformOperator()` from publishCatalogueAction -> this test failed
  // SAFETY: mutation check: removed `await platformOperator()` from discardCatalogueAction -> this test failed
  it('Scenario: Only operators can publish: a non-operator gets 403 and nothing is published or discarded', async () => {
    operator.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(publishCatalogueAction({ version: 2, revision: 4, reason: REASON })).rejects.toThrow('403');
    await expect(discardCatalogueAction({ version: 2, revision: 4 })).rejects.toThrow('403');
    expect(publishCatalogueDraft).not.toHaveBeenCalled();
    expect(discardCatalogueDraft).not.toHaveBeenCalled();
  });
});
