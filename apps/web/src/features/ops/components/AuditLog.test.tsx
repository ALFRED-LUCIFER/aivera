// @vitest-environment jsdom
import { intlConfig } from '@aivera/i18n';
import { IntlProvider } from '@aivera/i18n/react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuditLogView, AuditRow } from '../domain/audit.ts';
import { AuditLog } from './AuditLog.tsx';

// AIV-P2-054: the platform audit log, rendered with the console's translations. Synthetic people (personas.md).
vi.mock('next/form', () => ({ default: (props: React.ComponentProps<'form'>) => <form {...props} /> }));
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const THEO = '0190d4a2-0000-7000-8000-00000000a002';
const GULF = '0190d4a2-0000-7000-8000-000000000002';
const show = (view: AuditLogView) =>
  render(
    <IntlProvider {...intl}>
      <AuditLog {...view} />
    </IntlProvider>,
  );
const ready = (rows: AuditRow[], extra: { filtered?: boolean; nextHref?: string | null } = {}) =>
  ({ status: 'ready', rows, filtered: false, nextHref: null, ...extra }) as const;
const cellsOf = (row: number) =>
  within(screen.getAllByRole('row')[row] as HTMLElement)
    .getAllByRole('cell')
    .map((c) => c.textContent);

const suspended: AuditRow = {
  id: '0190d4a2-0000-7000-8000-0000000000e1',
  // 23:30 UTC is the next day in Dubai: the page states UTC, not the platform zone.
  occurredAt: new Date('2026-11-18T23:30:00Z'),
  actorId: PIA,
  operatorName: 'Pia Platform',
  action: 'workspace.suspended',
  subject: { type: 'workspace', id: GULF },
  note: 'Pilot ended on 30 Nov 2026',
  before: { status: 'active' },
  after: { status: 'suspended' },
};
const budget: AuditRow = {
  id: '0190d4a2-0000-7000-8000-0000000000e2',
  occurredAt: new Date('2026-11-19T08:05:00Z'),
  actorId: THEO,
  operatorName: null,
  action: 'ai_budget.changed',
  subject: { type: 'workspace', id: GULF },
  note: 'Pilot cap',
  before: { dailyTokenBudget: 2_000_000 },
  after: { dailyTokenBudget: 500_000 },
};
const opened: AuditRow = {
  ...budget,
  id: 'e3',
  action: 'ops.console_opened',
  subject: null,
  note: null,
  before: null,
  after: null,
};

describe('Scenario: The log lists entries newest first', () => {
  it('shows time (UTC), operator by name, action name, target link, reason and before → after, in the given order', () => {
    show({ table: ready([budget, suspended, opened]) });
    const table = screen.getByRole('table', { name: 'Platform audit log' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Time', 'Operator', 'Action', 'Target', 'Reason', 'Before → after']);
    expect(cellsOf(1)).toEqual([
      '2026-11-19 08:05 (UTC)',
      'Name not set',
      'Daily AI budget changed',
      `Workspace ${GULF}`,
      'Pilot cap',
      'Daily AI budget: 2,000,000 → 500,000',
    ]);
    expect(cellsOf(2)).toEqual([
      '2026-11-18 23:30 (UTC)',
      'Pia Platform',
      'Suspended',
      `Workspace ${GULF}`,
      'Pilot ended on 30 Nov 2026',
      'Status: Active → Suspended',
    ]);
    expect(cellsOf(3)).toEqual(['2026-11-19 08:05 (UTC)', 'Name not set', 'Console opened', 'None', 'None', 'None']);
    expect(screen.getAllByRole('link', { name: `Workspace ${GULF}` })[0]?.getAttribute('href')).toBe(
      `/ops/workspaces/${GULF}`,
    );
  });
});

describe('Scenario Outline: Filters narrow the list', () => {
  it('is a form whose fields carry only an action key, an opaque operator id, a target id and days', () => {
    show({
      filters: {
        params: { action: 'workspace.suspended', actor: PIA },
        operators: [{ id: PIA, name: 'Pia Platform' }],
      },
      table: ready([suspended], { filtered: true }),
    });
    const form = screen.getByRole('form', { name: 'Filter the audit log' });
    expect(form.getAttribute('action')).toBe('/ops/audit');
    expect((screen.getByLabelText('Action') as HTMLSelectElement).value).toBe('workspace.suspended');
    expect(
      (within(screen.getByLabelText('Action')).getByRole('option', { name: 'Suspended' }) as HTMLSelectElement).value,
    ).toBe('workspace.suspended');
    // Scenario: No personal data in URLs: the operator option submits her opaque id, never her name or email.
    expect((screen.getByLabelText('Operator') as HTMLSelectElement).value).toBe(PIA);
    expect(
      (within(screen.getByLabelText('Operator')).getByRole('option', { name: 'Pia Platform' }) as HTMLSelectElement)
        .value,
    ).toBe(PIA);
    expect([...form.querySelectorAll('[name]')].map((el) => el.getAttribute('name'))).toEqual([
      'action',
      'actor',
      'target',
      'from',
      'to',
    ]);
    expect(screen.getByLabelText('From (UTC)').getAttribute('type')).toBe('date');
    expect(screen.getByRole('link', { name: 'Clear filters' }).getAttribute('href')).toBe('/ops/audit');
  });
});

describe('Scenario: Pagination', () => {
  it('links "Next page" to the next page and shows none on the last page', () => {
    const next = `/ops/audit?action=workspace.suspended&cursor=${suspended.id}`;
    show({ table: ready([suspended], { nextHref: next }) });
    expect(screen.getByRole('link', { name: 'Next page' }).getAttribute('href')).toBe(next);
    cleanup();
    show({ table: ready([suspended]) });
    expect(screen.queryByRole('link', { name: 'Next page' })).toBeNull();
  });
});

describe('Scenario Outline: States', () => {
  it.each([
    ['no entry exists', ready([]), 'No operator actions yet.'],
    ['no entry matches', ready([], { filtered: true }), 'No entries match these filters.'],
    ['the read fails', { status: 'error', onRetry: () => {} } as const, 'We could not load the audit log. Try again.'],
    ['the page is loading', { status: 'loading' } as const, 'Loading the audit log…'],
  ])('%s', (_state, table, copy) => {
    show({ table });
    expect(screen.getByText(copy).textContent).toBe(copy);
  });
});
