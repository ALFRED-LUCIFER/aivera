// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobDetail, JobDetailFailed, type JobDetailProps } from './JobDetail.tsx';

afterEach(cleanup); // Vitest globals are off, so Testing Library cannot register its own cleanup.

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const props: JobDetailProps = {
  title: 'Senior AI Engineer',
  descriptor: 'A BNPL fintech',
  location: 'DIFC, Dubai',
  jobTypeLabel: 'AI and LLM engineering',
  pay: 'AED 35,000 to 48,000 a month',
  postedDays: 6,
  competencies: [
    {
      name: 'LLM systems in production',
      evidenceExpected: 'A shipped assistant or RAG system with real users, and their part in it',
      levelNeeded: 4,
    },
    { name: 'Product judgement', evidenceExpected: 'A decision they made and why', levelNeeded: 3 },
  ],
};
const renderDetail = () =>
  render(
    <IntlProvider {...intl}>
      <JobDetail {...props} />
    </IntlProvider>,
  );

describe('JobDetail (AIV-P3-005)', () => {
  it("shows the job's descriptor, pay and each competency with its evidence and level", () => {
    renderDetail();
    expect(screen.getByRole('heading', { level: 1, name: 'Senior AI Engineer' })).toBeDefined();
    expect(screen.getByText('A BNPL fintech · DIFC, Dubai')).toBeDefined();
    expect(screen.getByText('AED 35,000 to 48,000 a month')).toBeDefined();
    const needs = within(screen.getByRole('region', { name: 'What this job needs' }));
    const row = within(needs.getAllByRole('listitem')[0] as HTMLElement);
    expect(row.getByRole('heading', { level: 3, name: 'LLM systems in production' })).toBeDefined();
    expect(row.getByText(/A shipped assistant or RAG system/)).toBeDefined();
    expect(row.getByText('4 of 5')).toBeDefined();
  });

  it('states how candidates are judged', () => {
    renderDetail();
    const judged = within(screen.getByRole('region', { name: 'How you will be judged' }));
    for (const line of [
      'On work you can show. There is no test.',
      'What you state without evidence is treated as a claim, and you may be asked for more.',
      'A person makes every decision. Nobody is rejected automatically.',
    ])
      expect(judged.getByText(line)).toBeDefined();
  });

  it('links to no page that is not built: no Apply, CV check or Plans', () => {
    renderDetail();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('shows no weight, client name, candidate or score', () => {
    renderDetail();
    expect(document.body.textContent).not.toMatch(/weight|%|score|candidate ranking|Falcon/i);
  });

  it('failed: an alert, Try again retries, and All jobs leads back', async () => {
    const onRetry = vi.fn();
    render(
      <IntlProvider {...intl}>
        <JobDetailFailed onRetry={onRetry} />
      </IntlProvider>,
    );
    expect(screen.getByRole('alert').textContent).toBe('We could not load this job. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'See all jobs' })).toHaveProperty('pathname', '/candidates/jobs');
  });
});
