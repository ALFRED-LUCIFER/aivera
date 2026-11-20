// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AiBudgetView } from '../domain/aiBudget.ts';
import type { WorkspaceRow } from '../domain/workspaces.ts';
import { AiBudgetForm } from './AiBudgetForm.tsx';
import { AiTokenUse } from './AiTokenUse.tsx';

// AIV-P2-038: the AI token use card and the budget form, rendered with the console's translations.
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const show = (node: React.ReactNode) => render(<IntlProvider {...intl}>{node}</IntlProvider>);
const days = ['2026-11-25', '2026-11-24', '2026-11-23', '2026-11-22', '2026-11-21', '2026-11-20', '2026-11-19'];
const use = (extra: Partial<NonNullable<WorkspaceRow['ai']>> = {}): NonNullable<WorkspaceRow['ai']> => ({
  dailyBudget: 2_000_000,
  overridden: false,
  days: days.map((day, i) => ({ day, tokens: i === 0 ? 1_500 : 0 })),
  ...extra,
});
const facts = () =>
  Object.fromEntries(
    screen.getAllByRole('term').map((term) => [term.textContent, term.nextElementSibling?.textContent]),
  );

describe('Scenario: Use is shown as observed', () => {
  it('"AI tokens today" reads "1,500 of 2,000,000" with "Observed", and the last 7 UTC days are each observed', () => {
    show(<AiTokenUse ai={use()} />);
    expect(facts()).toEqual({
      'AI tokens today': '1,500 of 2,000,000Observed',
      'Daily AI budget': '2,000,000 (platform default)',
    });
    const table = screen.getByRole('table', { name: 'AI tokens, last 7 UTC days' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(days);
    expect(rows.map((r) => within(r).getAllByRole('cell')[2]?.textContent)).toEqual(Array(7).fill('Observed'));
    expect(within(rows[0] as HTMLElement).getAllByRole('cell')[1]?.textContent).toBe('1,500');
  });

  it('an override reads "500,000 (set by an operator)"', () => {
    show(<AiTokenUse ai={use({ dailyBudget: 500_000, overridden: true })} />);
    expect(facts()['Daily AI budget']).toBe('500,000 (set by an operator)');
  });
});

describe('Scenario: Usage not available', () => {
  it('"AI tokens today" reads "Not yet available" with the marker "Not yet available", and no budget or days', () => {
    show(<AiTokenUse ai={null} />);
    expect(facts()).toEqual({ 'AI tokens today': 'Not yet availableNot yet available' });
    expect(screen.queryByRole('table')).toBeNull();
  });
});

const view = (extra: Partial<AiBudgetView> = {}): AiBudgetView => ({
  budget: '',
  reason: '',
  error: null,
  onBudgetChange: vi.fn(),
  onReasonChange: vi.fn(),
  onPreview: vi.fn(),
  onPreviewReset: vi.fn(),
  preview: null,
  onConfirm: vi.fn(async () => {}),
  onCancel: vi.fn(),
  saved: undefined,
  ...extra,
});

describe('the budget form', () => {
  it('Scenario Outline: Bounds: the message is tied to the field', () => {
    show(<AiBudgetForm overridden={false} view={view({ budget: '99,999', error: 'bounds' })} />);
    const field = screen.getByRole('textbox', { name: 'New daily budget (tokens)' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('The budget must be between 100,000 and 10,000,000.');
    expect(field.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
  });

  it('a missing reason is flagged on the reason', () => {
    show(<AiBudgetForm overridden={false} view={view({ error: 'reason' })} />);
    expect(screen.getByRole('textbox', { name: 'Reason' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Write the reason for this change.');
  });

  it('Enter in the field asks for the preview; "Reset to default" shows only for an override', async () => {
    const v = view();
    show(<AiBudgetForm overridden={false} view={v} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'New daily budget (tokens)' }), '5{Enter}');
    expect(v.onBudgetChange).toHaveBeenCalledWith('5');
    expect(v.onPreview).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull();
    cleanup();
    show(<AiBudgetForm overridden view={v} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(v.onPreviewReset).toHaveBeenCalledOnce();
  });

  it('Scenario: Setting an override: the preview shows old and new, and only Confirm applies it', async () => {
    const v = view({ preview: { from: 2_000_000, to: 500_000, reset: false } });
    show(<AiBudgetForm overridden={false} view={v} />);
    const dialog = screen.getByRole('dialog', { name: 'Preview: change the daily AI budget' });
    expect(dialog.textContent).toContain('From 2,000,000 to 500,000 tokens per UTC day.');
    expect(dialog.textContent).toContain('Nothing changes until you confirm.');
    expect(v.onConfirm).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm change' }));
    expect(v.onConfirm).toHaveBeenCalledOnce();
  });

  it('a confirmed change is announced', () => {
    show(<AiBudgetForm overridden view={view({ saved: 500_000 })} />);
    expect(screen.getByRole('status').textContent).toBe('Daily AI budget set to 500,000.');
  });
});
