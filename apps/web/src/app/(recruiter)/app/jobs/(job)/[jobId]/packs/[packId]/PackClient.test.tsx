// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackPage } from '@/features/decision-pack/domain/pack.ts';
import { PackClient } from './PackClient.tsx';

// AIV-P2-012: "Record the decision" on the pack, with its controller; the server action and the router are faked. The
// hiring owner's authority and the stored decisions are proven against PostgreSQL in tests/integration. Synthetic cast.
const fake = vi.hoisted(() => ({ record: vi.fn(), refresh: vi.fn() }));
vi.mock('@/features/decision-pack/services/recordDecisions.ts', () => ({ recordDecisions: fake.record }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: fake.refresh }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});
beforeEach(() => fake.record.mockResolvedValue({ ok: true }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const id = (n: number) => `0190d4a2-0000-7000-9000-${String(n).padStart(12, '0')}`;
const [JOB, PACK, SARA, ARJUN, HUDA] = [id(1), id(2), id(21), id(22), id(23)];
const NAMES = ['Sara Al Qahtani', 'Arjun Menon', 'Huda Al Mansoori'];
const WHY = 'Strong on the two heaviest competencies.';
const decidedAt = new Date('2026-11-18T09:30:00.000Z');

const pack = (over: Partial<PackPage> = {}): PackPage => ({
  jobId: JOB,
  packId: PACK,
  name: 'Round 2 shortlist',
  job: 'Senior AI Engineer',
  preparedAt: new Date('2026-11-17T08:00:00.000Z'),
  rubricVersion: 2,
  role: null,
  members: [SARA, ARJUN, HUDA].map((candidateId, i) => ({
    candidateId,
    name: NAMES[i] ?? null,
    backedScore: 68,
    upperBound: 84,
    added: null,
    // Credalent recommends advancing Sara: it must not pre-select her decision.
    summary: {
      status: 'ready',
      summary: {
        strengths: [],
        risks: [],
        round1: null,
        recommendation: { action: 'advance', focus: null, citations: [] },
      },
    },
    decision: null,
  })),
  others: 2,
  mayDecide: true,
  decided: null,
  ...over,
});
const show = (page: PackPage) =>
  render(
    <IntlProvider {...intl}>
      <PackClient pack={page} />
    </IntlProvider>,
  );
const group = (name: string) => screen.getByRole('radiogroup', { name: `Your decision for ${name}` });
const choose = (name: string, option: string) =>
  userEvent.click(within(group(name)).getByRole('radio', { name: option }));

describe('Scenario: Record decisions', () => {
  it('nothing is chosen at first, even where Credalent recommends advancing', () => {
    show(pack());
    for (const name of NAMES)
      expect(
        within(group(name))
          .getAllByRole('radio')
          .map((r) => (r as HTMLInputElement).checked),
      ).toEqual([false, false, false]);
    expect(screen.getByText(/No candidate is contacted until you send a message yourself\./)).toBeTruthy();
  });

  // SAFETY: mutation check: onRecord opened the preview without the undecided() check -> this test failed (preview shown)
  it('Scenario: Every candidate needs a choice: nothing for Huda, "Record decisions" says so and records nothing', async () => {
    show(pack());
    await choose('Sara Al Qahtani', 'Advance to Round 2');
    await choose('Arjun Menon', 'Advance to Round 2');
    await userEvent.click(screen.getByRole('button', { name: 'Record decisions' }));
    expect(screen.getByRole('alert').textContent).toBe('Choose a decision for Huda Al Mansoori');
    expect(group('Huda Al Mansoori').getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('region', { name: /^Preview/ })).toBeNull();
    expect(fake.record).not.toHaveBeenCalled();
  });

  it('advance for all three, previewed with each stage and a reason, then recorded once on Confirm', async () => {
    const { rerender } = show(pack());
    for (const name of NAMES) await choose(name, 'Advance to Round 2');
    await userEvent.click(screen.getByRole('button', { name: 'Record decisions' }));
    const preview = screen.getByRole('region', { name: 'Preview: record 3 decisions' });
    expect(within(preview).getAllByText('Advance to Round 2. The stage becomes Round 2 shortlist.')).toHaveLength(3);
    expect(preview.textContent).toContain('Nothing changes until you confirm.');
    // One primary button in view: "Record decisions" gives way to the preview's Confirm.
    expect(screen.queryByRole('button', { name: 'Record decisions' })).toBeNull();
    const confirm = within(preview).getByRole('button', { name: 'Record 3 decisions' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(within(preview).getByRole('textbox', { name: /^Reason/ }), WHY);
    await userEvent.click(confirm);
    expect(fake.record).toHaveBeenCalledTimes(1);
    expect(fake.record).toHaveBeenCalledWith({
      packId: PACK,
      decisions: [SARA, ARJUN, HUDA].map((candidateId) => ({ candidateId, decision: 'advance' })),
      reason: WHY,
    });
    expect(fake.refresh).toHaveBeenCalled();
    // The page re-reads the decided pack.
    rerender(
      <IntlProvider {...intl}>
        <PackClient
          pack={pack({
            decided: { by: 'Hassan Haddad', at: decidedAt },
            members: pack().members.map((m) => ({ ...m, decision: 'advance' })),
          })}
        />
      </IntlProvider>,
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Decisions recorded by you on 18 Nov 2026 and added to the audit trail. Schedule Round 2 interviews',
    );
    expect(screen.getByRole('link', { name: 'Schedule Round 2 interviews' }).getAttribute('href')).toBe(
      `/app/jobs/${JOB}/interviews`,
    );
  });

  it('do not advance and hold say what happens to the stage; a refused record keeps the preview and says nothing was recorded', async () => {
    fake.record.mockResolvedValue({ ok: false, error: 'failed' });
    show(pack());
    await choose('Sara Al Qahtani', 'Advance to Round 2');
    await choose('Arjun Menon', 'Do not advance');
    await choose('Huda Al Mansoori', 'Hold');
    await userEvent.click(screen.getByRole('button', { name: 'Record decisions' }));
    const preview = screen.getByRole('region', { name: 'Preview: record 3 decisions' });
    expect(within(preview).getByText('Do not advance. The stage becomes Not advanced.')).toBeTruthy();
    expect(within(preview).getByText('Hold. The stage stays as it is.')).toBeTruthy();
    await userEvent.type(within(preview).getByRole('textbox', { name: /^Reason/ }), WHY);
    await userEvent.click(within(preview).getByRole('button', { name: 'Record 3 decisions' }));
    expect(within(preview).getByRole('alert').textContent).toBe(
      'That did not go through. Nothing was recorded. Try again.',
    );
    expect(fake.refresh).not.toHaveBeenCalled();
  });
});

describe('Scenario: Only the authorised hiring owner', () => {
  it('a recruiter sees the choices read-only with "Only the hiring owner can record decisions", and no way to record', () => {
    show(pack({ mayDecide: false }));
    for (const name of NAMES)
      expect(
        within(group(name))
          .getAllByRole('radio')
          .every((r) => r.matches(':disabled')),
      ).toBe(true);
    expect(screen.getByText('Only the hiring owner can record decisions.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record decisions' })).toBeNull();
  });
});

describe('Scenario: Already decided', () => {
  it('reopened, the decisions are read-only, each shown, with who recorded them and when', () => {
    show(
      pack({
        decided: { by: 'Hassan Haddad', at: decidedAt },
        members: pack().members.map((m, i) => ({ ...m, decision: i === 1 ? 'do_not_advance' : 'advance' })),
      }),
    );
    const arjun = within(group('Arjun Menon')).getByRole('radio', { name: 'Do not advance' }) as HTMLInputElement;
    expect([arjun.checked, arjun.matches(':disabled')]).toEqual([true, true]);
    expect(
      (within(group('Sara Al Qahtani')).getByRole('radio', { name: 'Advance to Round 2' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      screen.getByText(/^Decisions recorded by Hassan Haddad on 18 Nov 2026 and added to the audit trail\./),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record decisions' })).toBeNull();
  });
});
