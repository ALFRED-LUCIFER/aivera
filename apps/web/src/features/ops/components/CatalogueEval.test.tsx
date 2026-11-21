// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CatalogueEvalViewModel, EvalView } from '../domain/catalogueEval.ts';
import { CatalogueEval } from './CatalogueEval.tsx';

// AIV-P2-048: the draft's eval panel in each state. Synthetic golden case ids only.
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const finishedAt = new Date('2026-11-21T09:05:00Z');
const show = (view: EvalView, patch: Partial<CatalogueEvalViewModel> = {}) => {
  const model: CatalogueEvalViewModel = { view, pending: false, error: null, onRun: vi.fn(async () => {}), ...patch };
  render(
    <IntlProvider {...intl}>
      <CatalogueEval eval={model} />
    </IntlProvider>,
  );
  return model;
};
const metrics = [
  { key: 'domain' as const, percent: 94.4 },
  { key: 'none' as const, percent: 100 },
  { key: 'fairness' as const, percent: 100 },
];

describe('the eval panel', () => {
  it('Scenario: A passing run shows the icon and word, the run time and each rate marked Observed', () => {
    show({
      status: 'passed',
      finishedAt,
      uncovered: [],
      failedCases: [],
      tasks: [{ task: 'detectDomain', metrics }],
    });
    expect(screen.getByRole('status').textContent).toContain('Eval passed');
    expect(screen.getByRole('status').querySelector('svg')).not.toBeNull();
    expect(screen.getByText(/Ran on .* at 13:05 \(Asia\/Dubai\)/)).toBeTruthy();
    expect(screen.getByText('Domain accuracy')).toBeTruthy();
    expect(screen.getByText('No clear domain')).toBeTruthy();
    expect(screen.getByText('Fairness')).toBeTruthy();
    expect(screen.getAllByText('Observed')).toHaveLength(3);
  });

  it('Scenario: A failing run lists what failed', () => {
    show({
      status: 'failed',
      finishedAt,
      uncovered: [],
      failedCases: ['software-engineer', 'data-scientist'],
      tasks: [{ task: 'draftCompetencies', metrics: [{ key: 'fieldMatch', percent: 61.5 }] }],
    });
    expect(screen.getByRole('status').textContent).toContain('Eval failed');
    expect(screen.getByText('software-engineer')).toBeTruthy();
    expect(screen.getByText('data-scientist')).toBeTruthy();
  });

  it('Scenario: A new pack without golden cases names the key', () => {
    show({ status: 'failed', finishedAt, uncovered: ['insurance'], failedCases: [], tasks: [] });
    expect(screen.getByText('Add golden cases for insurance in packages/ai/evals before publishing.')).toBeTruthy();
  });

  it('stale, could not run and running each say so; running cannot start another', () => {
    show({ status: 'stale' });
    expect(screen.getByText('The draft changed after the last eval run. Run it again.')).toBeTruthy();
    cleanup();
    show({ status: 'error' });
    expect(screen.getByText('The eval could not run. Try again.')).toBeTruthy();
    cleanup();
    show({ status: 'running' });
    expect(screen.getByRole('status').textContent).toContain('Eval running…');
    expect(screen.getByRole('button', { name: 'Run the eval' })).toHaveProperty('disabled', true);
  });

  it('"Run the eval" asks for a run; a refusal is shown', async () => {
    const model = show({ status: 'not_run' }, { error: { ok: false, error: 'eval_running' } });
    await userEvent.click(screen.getByRole('button', { name: 'Run the eval' }));
    expect(model.onRun).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert').textContent).toContain('An eval run is already in progress.');
  });
});
