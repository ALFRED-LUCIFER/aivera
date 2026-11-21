// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApplicantList, type ApplicantListView } from './ApplicantList.tsx';

// AIV-P1-086. Synthetic cast only (docs/00-product/personas.md).
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const show = (view: ApplicantListView) =>
  render(
    <IntlProvider {...intl}>
      <ApplicantList view={view} />
    </IntlProvider>,
  );

describe('Scenario: Applicants appear right after adding them', () => {
  it('each row shows name, stage, received date, source and "Not yet scored" with the basis "Not yet available"', () => {
    show({
      status: 'ready',
      rows: [
        {
          applicationId: 'a1',
          displayName: 'Sara Al Qahtani',
          stage: 'new',
          // 22:30 UTC is 21 Nov in Dubai: the workspace time zone decides the day.
          receivedAt: new Date('2026-11-20T22:30:00.000Z'),
          source: 'linkedin',
        },
        { applicationId: 'a2', displayName: null, stage: 'withdrawn', receivedAt: new Date(), source: 'referral' },
      ],
    });
    const table = screen.getByRole('table', { name: 'Applicants' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Candidate', 'Received (Asia/Dubai)', 'Source', 'Backed score']);
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(first?.textContent).toBe('Sara Al QahtaniNew21 NovLinkedInNot yet scoredNot yet available');
    expect(second?.textContent).toMatch(/^Unnamed applicantWithdrawn.*Referral/);
    // Nobody is rejected automatically (AGENTS.md 1.5), said under the rows.
    expect(screen.getByText('Ranking orders your attention; nobody is rejected automatically.')).toBeTruthy();
  });
});

describe('Scenario: Empty job', () => {
  it("shows the Candidates tab's empty message", () => {
    show({ status: 'ready', rows: [] });
    expect(screen.getByText(/^No ranking yet\./)).toBeTruthy();
    expect(screen.queryByText(/nobody is rejected automatically/)).toBeNull();
  });
});

describe('Scenario: Loading and error states', () => {
  it('a slow read shows a table skeleton', () => {
    show({ status: 'loading' });
    expect(screen.getByRole('table', { name: 'Applicants' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Loading applicants');
  });

  it('a failed read says so and retries', async () => {
    const onRetry = vi.fn();
    show({ status: 'error', onRetry });
    expect(screen.getByRole('alert').textContent).toBe('We could not load applicants. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
