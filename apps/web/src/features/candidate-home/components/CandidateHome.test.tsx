// @vitest-environment jsdom
import { intlConfig } from '@aivera/i18n';
import { IntlProvider } from '@aivera/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CandidateHome, type CandidateHomeProps } from './CandidateHome.tsx';

afterEach(cleanup); // Vitest globals are off, so Testing Library cannot register its own cleanup.

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const three: NonNullable<CandidateHomeProps['newJobs']> = [
  {
    slug: 'senior-ai-engineer-3f9a1c0b2d4e',
    title: 'Senior AI Engineer',
    descriptor: 'A BNPL fintech',
    location: 'DIFC, Dubai',
    jobType: 'ai_llm_engineering',
    postedDays: 6,
  },
  {
    slug: 'qa-automation-engineer-0a1b2c3d4e5f',
    title: 'QA Automation Engineer',
    descriptor: 'A logistics platform',
    location: 'Dubai, hybrid',
    jobType: 'qa_test_automation',
    postedDays: 9,
  },
  {
    slug: 'senior-product-manager-payments-1a2b3c4d5e6f',
    title: 'Senior Product Manager, Payments',
    descriptor: 'A payments scale-up',
    location: 'Dubai Internet City',
    jobType: 'product_management',
    postedDays: 9,
  },
];
const renderHome = (newJobs: CandidateHomeProps['newJobs'] = three) =>
  render(
    <IntlProvider {...intl}>
      <CandidateHome newJobs={newJobs} plusPrice="AED 49 a month" />
    </IntlProvider>,
  );
const newSection = () => within(screen.getByRole('region', { name: 'New this week' }));

describe('CandidateHome (AIV-P3-003)', () => {
  it('the hero explains the promise, and Find jobs searches the jobs list', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1, name: 'Get hired for what you have done.' })).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 }).querySelector('mark')?.textContent).toBe('what you have done');
    expect(screen.getByText(/No tests to sit\./)).toBeDefined();
    expect(screen.getByText('Free to browse and apply. Always.')).toBeDefined();
    const search = screen.getByRole('searchbox', { name: 'Job title or skill' });
    expect(search.closest('form')?.getAttribute('action')).toBe('/candidates/jobs');
    expect(search.getAttribute('name')).toBe('q');
    expect(screen.getByRole('button', { name: 'Find jobs' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Check my CV, free' })).toHaveProperty('pathname', '/candidates/cv-check');
  });

  it('the sample job shows what will be judged', () => {
    renderHome();
    const card = screen.getByRole('region', { name: 'Example: Senior AI Engineer' });
    expect(within(card).getByText('What this job needs')).toBeDefined();
    const rows = within(card)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(rows).toEqual([
      'LLM systems in production4 of 5',
      'Retrieval and evaluation4 of 5',
      'Python service engineering3 of 5',
      'Product judgement3 of 5',
    ]);
    expect(within(card).getByText('You see this before you apply, so you know what will be judged.')).toBeDefined();
  });

  it('the principles are stated', () => {
    renderHome();
    const principle = screen.getByRole('heading', { level: 3, name: 'Nobody is rejected automatically' });
    expect(principle.nextElementSibling?.textContent).toBe(
      'A person makes every decision. Thin evidence gets a request for more, not a silent no.',
    );
  });

  it('New this week lists the jobs with their descriptor, job type and View job, and links All jobs', () => {
    renderHome();
    expect(
      newSection()
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(three.map((j) => j.title));
    expect(newSection().getByText('A BNPL fintech · DIFC, Dubai')).toBeDefined();
    expect(newSection().getByText('AI and LLM engineering')).toBeDefined();
    expect(newSection().getByRole('link', { name: 'View job: Senior AI Engineer' })).toBeDefined();
    expect(newSection().getByRole('link', { name: 'All jobs' })).toHaveProperty('pathname', '/candidates/jobs');
  });

  it('no jobs published yet: the message, and All jobs stays', () => {
    renderHome([]);
    expect(newSection().getByText('No new jobs this week. Check back soon.')).toBeDefined();
    expect(newSection().getByRole('link', { name: 'All jobs' })).toBeDefined();
  });

  it('the jobs feed fails: the rest renders and New this week says so', () => {
    renderHome(null);
    expect(newSection().getByRole('alert').textContent).toBe('Jobs could not load. Try again.');
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Want an edge that is still honest?' })).toBeDefined();
  });

  it('the Plus teaser shows the price and links Plans, and promises no rank', () => {
    renderHome();
    expect(screen.getByText(/before you apply\. AED 49 a month\.$/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'See what Plus adds' })).toHaveProperty('pathname', '/candidates/plans');
    expect(document.body.textContent).not.toMatch(/rank higher|top of the list|boost/i);
  });
});
