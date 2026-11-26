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
  // 21:30 UTC is 17 Nov in Dubai.
  preparedAt: new Date('2026-11-16T21:30:00.000Z'),
  members: [
    {
      candidateId: id(1),
      name: 'Sara Al Qahtani',
      backedScore: 68,
      upperBound: 84,
      summary: {
        strengths: [row(id(10), 'LLM systems in production', 4, 4, 3)],
        risks: [row(id(11), 'Cost and reliability', 1, 4, 2)],
        explanation: {
          source: 'template',
          statements: [
            {
              text: 'The cited work behind LLM systems in production.',
              citations: [
                { itemId: null, label: 'facts', quote: 'LLM systems in production' },
                { itemId: id(20), label: 'llm-eval-harness', quote: 'authored 412 of 460 commits' },
              ],
            },
          ],
        },
      },
    },
    { candidateId: id(2), name: 'Arjun Menon', backedScore: 64, upperBound: 76, summary: null },
  ],
};

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;

function renderPreview() {
  return render(
    <IntlProvider {...intl}>
      <PackPreview jobId={id(30)} packId={id(31)} preview={preview} />
    </IntlProvider>,
  );
}

describe('PackPreview', () => {
  it('Scenario: Open the preview: each name, score with its range and basis, strengths, risks and the cited summary', () => {
    renderPreview();
    expect(screen.getByRole('heading', { level: 2, name: 'Round 2 shortlist: Senior AI Engineer' })).toBeTruthy();
    const sara = screen.getByRole('region', { name: 'Sara Al Qahtani' });
    expect(within(sara).getByRole('img', { name: '68 backed by evidence · up to 84 if claims hold' })).toBeTruthy();
    expect(within(sara).getByRole('list', { name: 'Backed by evidence' }).textContent).toContain(
      'LLM systems in production',
    );
    expect(within(sara).getByRole('list', { name: 'Still to test in the interview' }).textContent).toContain(
      'Cost and reliability',
    );
    expect(within(sara).getByText("Credalent's summary")).toBeTruthy();
    expect(within(sara).getByText('authored 412 of 460 commits').closest('mark')).toBeTruthy();
    expect(within(sara).getByText('Source: llm-eval-harness')).toBeTruthy();
    expect(within(sara).getByText('Summary generated without AI')).toBeTruthy();
    // A member whose assessment moved on keeps the pack's scores, with no reasons from the newer one.
    const arjun = screen.getByRole('region', { name: 'Arjun Menon' });
    expect(within(arjun).getByRole('img', { name: '64 backed by evidence · up to 76 if claims hold' })).toBeTruthy();
    expect(within(arjun).getByText(/^Summary unavailable/)).toBeTruthy();
    expect(screen.getByText('Observed')).toBeTruthy();
    expect(screen.getByText('Powered by Credalent')).toBeTruthy();
    expect(screen.getByText('Prepared 17 Nov 2026 · Confidential')).toBeTruthy();
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
