// @vitest-environment jsdom
import { intlConfig } from '@aivera/i18n';
import { IntlProvider } from '@aivera/i18n/react';
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
    show({ status: 'ready', rubric: { shown: null, history: [], edit: null, review: null, approvedCompetencies: 0 } });
    expect(screen.getByText('No rubric yet.')).toBeTruthy();
    expect(screen.queryByText(/Weights total/)).toBeNull();
  });
});
