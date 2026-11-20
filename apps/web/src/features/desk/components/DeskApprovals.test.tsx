// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DeskApprovals, type DeskState } from './DeskApprovals.tsx';

afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const show = (state: DeskState) =>
  render(
    <IntlProvider {...intl}>
      <DeskApprovals state={state} />
    </IntlProvider>,
  );

describe('My desk rubric approvals: states (AIV-P1-014)', () => {
  it('empty: nothing is waiting on others', () => {
    show({ status: 'ready', items: [] });
    expect(screen.getByText('Nothing is waiting on others.')).toBeTruthy();
  });

  it('loading is announced as busy', () => {
    show({ status: 'loading' });
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Loading what is waiting');
  });

  it('error: an alert with a retry', async () => {
    const onRetry = vi.fn();
    show({ status: 'error', onRetry });
    expect(screen.getByRole('alert').textContent).toContain('We could not load your desk. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('a waiting item and a done one, each with an icon and word for its status', () => {
    show({
      status: 'ready',
      items: [
        { jobId: 'j2', job: 'Staff Backend Engineer', version: 2, owner: 'VP Engineering', done: false },
        { jobId: 'j1', job: 'Senior AI Engineer', version: 2, owner: null, done: true },
      ],
    });
    expect(screen.getByText('Staff Backend Engineer, version 2. With the VP Engineering.')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the Senior AI Engineer rubric' }).getAttribute('href')).toBe(
      '/app/jobs/j1/rubric',
    );
  });
});
