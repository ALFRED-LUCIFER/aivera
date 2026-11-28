// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PackPreview as Preview } from '../domain/pack.ts';
import { PackPreview } from './PackPreview.tsx';

// AIV-P1-116: the pack as the hiring owner will see it. Synthetic cast and ids only.
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const row = (competencyId: string, name: string, proven: number, claimed: number, needed: number) => ({
  competencyId,
  name,
  proven,
  claimed,
  needed,
});
const preview: Preview = {
  workspace: 'Gulf Talent Partners',
  name: 'Round 2 shortlist',
  job: 'Senior AI Engineer',
  client: null,
  // 21:30 UTC is 17 Nov in Dubai.
  preparedAt: new Date('2026-11-16T21:30:00.000Z'),
  members: [
    {
      candidateId: id(1),
      name: 'Sara Al Qahtani',
      backedScore: 68,
      upperBound: 84,
      summary: {
        status: 'ready',
        summary: {
          strengths: [
            {
              text: 'The candidate authored 412 of 460 commits in llm-eval-harness.',
              citations: [
                { itemId: id(20), label: 'llm-eval-harness', quote: 'authored 412 of 460 commits', claim: false },
              ],
            },
          ],
          risks: [
            {
              text: 'Cost and reliability is a claim with nothing to inspect.',
              citations: [
                { itemId: null, label: 'Assessment', quote: 'Cost and reliability, 15% of the weight', claim: false },
              ],
            },
          ],
          round1: null,
          recommendation: {
            action: 'advance',
            focus: 'Cost and reliability',
            citations: [{ itemId: null, label: 'Assessment', quote: 'Work meets the need', claim: false }],
          },
        },
      },
    },
    {
      candidateId: id(2),
      name: 'Arjun Menon',
      backedScore: 64,
      upperBound: 76,
      summary: {
        status: 'unavailable',
        strengths: [row(id(10), 'LLM systems in production', 4, 4, 3)],
        risks: [row(id(11), 'Cost and reliability', 1, 4, 2)],
      },
    },
    { candidateId: id(3), name: 'Huda Al Mansoori', backedScore: 61, upperBound: 82, summary: { status: 'preparing' } },
  ],
};

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;

function renderPreview(client: string | null = null) {
  return render(
    <IntlProvider {...intl}>
      <PackPreview jobId={id(30)} packId={id(31)} preview={{ ...preview, client }} />
    </IntlProvider>,
  );
}

describe('PackPreview', () => {
  it('Scenario: Open the preview: each name, score with its range and basis, the cited strengths, risks and recommendation', () => {
    renderPreview();
    expect(screen.getByRole('heading', { level: 2, name: 'Round 2 shortlist: Senior AI Engineer' })).toBeTruthy();
    const sara = screen.getByRole('region', { name: 'Sara Al Qahtani' });
    expect(within(sara).getByRole('img', { name: '68 backed by evidence · up to 84 if claims hold' })).toBeTruthy();
    expect(within(sara).getByRole('list', { name: 'Backed by evidence' }).textContent).toContain(
      'The candidate authored 412 of 460 commits in llm-eval-harness.',
    );
    expect(within(sara).getByRole('list', { name: 'Still to test in the interview' }).textContent).toContain(
      'Cost and reliability is a claim with nothing to inspect.',
    );
    expect(within(sara).getByText('authored 412 of 460 commits').closest('mark')).toBeTruthy();
    expect(within(sara).getByText('Source: llm-eval-harness')).toBeTruthy();
    // AIV-P1-165: the recommendation is the recruiter's workspace's, marked "Prepared with Credalent".
    expect(within(sara).getByText('Gulf Talent Partners recommends:').textContent).toBe(
      'Gulf Talent Partners recommends: advance, and look into Cost and reliability next [1]',
    );
    expect(within(sara).getByText('Prepared with Credalent')).toBeTruthy();
    // AIV-P1-165: an empty "Round 1 finding" is left out.
    expect(within(sara).queryByText('Round 1 finding')).toBeNull();
    // No usable cited answer: the assessment's own levels against the need, from the snapshot the member joined with.
    const arjun = screen.getByRole('region', { name: 'Arjun Menon' });
    expect(within(arjun).getByRole('img', { name: '64 backed by evidence · up to 76 if claims hold' })).toBeTruthy();
    expect(within(arjun).getByText('Summary unavailable')).toBeTruthy();
    expect(within(arjun).getByRole('list', { name: 'Backed by evidence' }).textContent).toContain(
      'LLM systems in production',
    );
    expect(within(arjun).getByRole('list', { name: 'Still to test in the interview' }).textContent).toContain(
      'Cost and reliability',
    );
    const huda = screen.getByRole('region', { name: 'Huda Al Mansoori' });
    expect(within(huda).getByRole('status').textContent).toBe('Preparing summary');
    expect(screen.getByText('Observed')).toBeTruthy();
    expect(screen.getByText('Powered by Credalent')).toBeTruthy();
    expect(screen.getByText('Prepared 17 Nov 2026 · Confidential')).toBeTruthy();
  });

  // AIV-P1-165 section 13: the top summary, in the order given (loadPack orders by backed score), printed with the cards.
  it('Scenario: Ordered and summarised: the top summary lists each person with scores, one cited strength and one risk', () => {
    renderPreview();
    const rows = within(screen.getByRole('region', { name: 'Summary' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(rows).toEqual([
      'Sara Al Qahtani · 68 backed by evidence · up to 84 if claims holdHighest backed score in this pack.Strength: The candidate authored 412 of 460 commits in llm-eval-harness. · Source: llm-eval-harnessRisk: Cost and reliability is a claim with nothing to inspect. · Source: the assessment',
      'Arjun Menon · 64 backed by evidence · up to 76 if claims hold4 points below Sara Al Qahtani on backed score.Summary unavailable',
      'Huda Al Mansoori · 61 backed by evidence · up to 82 if claims hold3 points below Arjun Menon on backed score.Preparing summary',
    ]);
  });

  // AIV-P1-165 section 13.
  it('Scenario: Agency packs name the client: "Prepared for Falcon Pay"', () => {
    renderPreview('Falcon Pay');
    expect(screen.getByText('Prepared for Falcon Pay')).toBeTruthy();
  });

  it('Scenario: Neutral copy for an in-house team: the hiring owner is named, with no client wording', () => {
    const { container } = renderPreview();
    expect(screen.getByText(/^This is how the hiring owner will see this pack\./)).toBeTruthy();
    expect(screen.queryByText(/^Prepared for/)).toBeNull();
    expect(container.textContent).not.toMatch(/client/i);
  });

  it('Scenario: Branding: the header shows the workspace name and its mark', () => {
    const { container } = renderPreview();
    const header = container.querySelector('article header');
    expect(header?.textContent).toContain('Gulf Talent Partners');
    expect(header?.textContent).toContain('GT');
  });

  // SAFETY: mutation check: rendered "sara.alqahtani@example.com · +971 50 000 0001" under each name -> this test failed
  it('Scenario: No private data is shown, and Nothing leaves Credalent: no email, phone, file link, download or send', () => {
    const { container } = renderPreview();
    expect(container.textContent).not.toMatch(EMAIL);
    expect(container.textContent).not.toMatch(PHONE);
    expect(screen.queryAllByRole('button')).toEqual([]);
    // The only way out is back to the pack: no file, download, mail or share link.
    expect(screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Back to the pack', `/app/jobs/${id(30)}/packs/${id(31)}`],
    ]);
  });
});
