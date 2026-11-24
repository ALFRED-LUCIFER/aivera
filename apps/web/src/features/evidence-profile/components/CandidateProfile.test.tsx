// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Fit, ProfileData } from '../domain/profile.ts';
import { CandidateProfile, type CandidateProfileView } from './CandidateProfile.tsx';

// AIV-P1-043: the profile's states the e2e spec does not reach. Synthetic cast only (docs/00-product/personas.md).
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const scored: Fit = {
  status: 'scored',
  rank: 1,
  backedScore: 68,
  upperBound: 84,
  meetsNeed: 4,
  competencyCount: 6,
  ranked: 8,
  openClaims: 2,
};
const cited = {
  text: 'Most of the retrieval work is their own.',
  citations: [{ itemId: 'i1', label: 'eval-harness', quote: '412 of 460 commits' }],
};
const ready = (fit: Fit, explanation: ProfileData['explanation'] = null): CandidateProfileView => ({
  status: 'ready',
  jobId: '0190d4a2-0000-7000-9000-000000001031',
  jobTitle: 'Senior AI Engineer',
  name: 'Sara Al Qahtani',
  stage: 'new',
  fit,
  explanation,
});
const show = (view: CandidateProfileView) =>
  render(
    <IntlProvider {...intl}>
      <CandidateProfile view={view} />
    </IntlProvider>,
  );

describe('CandidateProfile states', () => {
  it('a slow read says the profile is loading', () => {
    show({ status: 'loading' });
    expect(screen.getByRole('status').textContent).toBe('Loading the candidate profile…');
  });

  it('a failed read says so and retries', async () => {
    const onRetry = vi.fn();
    show({ status: 'error', onRetry });
    expect(screen.getByRole('alert').textContent).toContain('We could not load this candidate. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('a candidate not yet scored shows "Not yet scored" with its basis, and no explanation', () => {
    show(ready({ status: 'not_scored' }));
    expect(screen.getByText('Not yet scored')).toBeTruthy();
    expect(screen.getByText('Not yet available')).toBeTruthy();
    expect(screen.queryByText('Why they are ranked here')).toBeNull();
  });

  it('a scored candidate with no explanation says none is available yet', () => {
    show(ready(scored));
    expect(screen.getByText(/rank 1 of 8/)).toBeTruthy();
    expect(screen.getByText('No explanation is available yet.')).toBeTruthy();
  });

  it('an AI explanation shows its cited phrase and source, without the "without AI" line', () => {
    show(ready(scored, { source: 'ai', statements: [cited, cited] }));
    expect(screen.getAllByText('412 of 460 commits')).toHaveLength(2);
    expect(screen.getAllByText('Source: eval-harness')).toHaveLength(2);
    expect(screen.queryByText('Summary generated without AI')).toBeNull();
  });

  it('a template explanation says "Summary generated without AI"', () => {
    show(ready(scored, { source: 'template', statements: [cited] }));
    expect(screen.getByText('Summary generated without AI')).toBeTruthy();
  });
});
