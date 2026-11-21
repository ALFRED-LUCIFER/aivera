import { CatalogueError } from '@credalent/jobs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  retireDraftEntryAction,
  runCatalogueEvalAction,
  saveDraftCompetencyAction,
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
const revalidatePath = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('@/server/operator', () => ({
  platformOperator: () => operator(),
  openCatalogueDraft: async () => {},
  saveCataloguePack: (...args: unknown[]) => saveCataloguePack(...args),
  saveCatalogueCompetency: (...args: unknown[]) => saveCatalogueCompetency(...args),
  retireCatalogueEntry: async () => 'retired',
  requestCatalogueEval: (...args: unknown[]) => requestCatalogueEval(...args),
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
    ])
      await expect(action()).rejects.toThrow('403');
    expect(saveCatalogueCompetency).not.toHaveBeenCalled();
    expect(saveCataloguePack).not.toHaveBeenCalled();
    expect(requestCatalogueEval).not.toHaveBeenCalled();
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
