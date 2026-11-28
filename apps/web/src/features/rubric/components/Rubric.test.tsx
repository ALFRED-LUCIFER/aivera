// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Rubric, type RubricState } from './Rubric.tsx';

afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const show = (state: RubricState) =>
  render(
    <IntlProvider {...intl}>
      <Rubric state={state} />
    </IntlProvider>,
  );

describe('Scenario: Loading and error', () => {
  it('a slow request shows a table skeleton', () => {
    show({ status: 'loading' });
    expect(screen.getByRole('table', { name: 'Agreed competencies' }).getAttribute('aria-busy')).toBe('true');
  });

  it('the rubric request fails: "We could not load this rubric. Try again." and a retry', async () => {
    const onRetry = vi.fn();
    show({ status: 'error', onRetry });
    expect(screen.getByRole('alert').textContent).toBe('We could not load this rubric. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('A job with no rubric', () => {
  it('says so, with no weights total', () => {
    show({
      status: 'ready',
      rubric: { shown: null, history: [], edit: null, review: null, approvable: null, approvedCompetencies: 0 },
    });
    expect(screen.getByText('No rubric yet.')).toBeTruthy();
    expect(screen.queryByText(/Weights total/)).toBeNull();
  });
});

// AIV-P1-165: "Levels and Mandatory are explained where they appear", "Scoring definitions are behind a toggle".
describe('A rubric read on its page', () => {
  const rubric = {
    shown: {
      version: 1,
      successStatement: '',
      competencies: [
        {
          name: 'Cost and reliability',
          evidenceExpected: 'Numbers on latency and cost',
          weightPercent: 100,
          levelNeeded: 2,
          type: 'mandatory' as const,
          origin: 'from_description' as const,
        },
      ],
    },
    history: [],
    edit: null,
    review: null,
    approvable: null,
    approvedCompetencies: 0,
  };

  it('each level has its one-line meaning beside it, and Mandatory is said never to reject', () => {
    show({ status: 'ready', rubric });
    const cell = screen.getByRole('cell', { name: /Level 2 of 5/ });
    expect(cell.textContent).toBe('Level 2 of 5Does routine tasks alone.');
    expect(screen.getByText(/^Mandatory never rejects anyone automatically\./)).toBeTruthy();
  });

  it('the scoring definitions are collapsed under "Show scoring definitions"', async () => {
    show({ status: 'ready', rubric });
    const toggle = screen.getByText('Show scoring definitions');
    const details = toggle.closest('details');
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('Stated, with nothing to inspect. Counts as zero.');
    await userEvent.click(toggle);
    expect(details?.open).toBe(true);
  });
});
