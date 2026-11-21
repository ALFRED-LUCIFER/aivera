// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DashboardView } from '../domain/dashboard.ts';
import { OpsDashboard } from './OpsDashboard.tsx';

// AIV-P2-051: the console home's tiles with the console's translations. Counts only, nothing named.
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const view: DashboardView = {
  statuses: [
    { status: 'active', count: 4 },
    { status: 'suspended', count: 1 },
    { status: 'pending_approval', count: 2 },
    { status: 'rejected', count: 0 },
  ],
  oldestWaitingDays: 3,
  ai: { tokens: 2_820_000, nearBudget: 1, atBudget: 1 },
  catalogue: { version: 1 },
};
const show = (v: Partial<DashboardView> = {}) =>
  render(
    <IntlProvider {...intl}>
      <OpsDashboard {...view} {...v} />
    </IntlProvider>,
  );
const tile = (label: string) => screen.getByText(label, { selector: 'p' }).parentElement as HTMLElement;

describe('Scenario: The dashboard shows observed counts with links', () => {
  it('shows each status with its count and "Observed"; waiting says "oldest 3 days" and links to approvals', () => {
    show();
    for (const [label, count] of [
      ['Active', '4'],
      ['Waiting for approval', '2'],
      ['Suspended', '1'],
      ['Not approved', '0'],
    ] as const)
      expect(tile(label).textContent).toContain(`${label}${count}Observed`);
    expect(tile('Waiting for approval').textContent).toContain('oldest 3 days');
    expect(screen.getByRole('link', { name: 'View approvals' }).getAttribute('href')).toBe('/ops/approvals');
    expect(screen.getByRole('link', { name: 'View suspended workspaces' }).getAttribute('href')).toBe(
      '/ops/workspaces?status=suspended',
    );
  });
});

describe('Scenario: AI tokens today against budgets', () => {
  it('shows the total marked "Observed", how many are near and at the budget, and links to the list by AI use', () => {
    show();
    const ai = tile('AI tokens today (UTC)').textContent;
    expect(ai).toContain('2,820,000Observed');
    expect(ai).toContain('1 at 80% or more');
    expect(ai).toContain('1 at the budget');
    expect(screen.getByRole('link', { name: 'View workspaces by AI use' }).getAttribute('href')).toBe(
      '/ops/workspaces?sort=ai',
    );
  });
});

describe('Scenario: A catalogue draft is waiting (published version only until AIV-P2-045/048)', () => {
  it('shows the live version and links to the catalogue', () => {
    show();
    expect(tile('Catalogue version').textContent).toContain('Version 1 live');
    expect(screen.getByRole('link', { name: 'Open the catalogue' }).getAttribute('href')).toBe('/ops/catalogue');
  });
});

describe('Scenario: Nothing to show yet', () => {
  it('workspace tiles show 0 "Observed"; AI says "Not yet available", never a 0', () => {
    show({
      statuses: view.statuses?.map((s) => ({ ...s, count: 0 })) ?? null,
      oldestWaitingDays: null,
      ai: { tokens: null, nearBudget: 0, atBudget: 0 },
    });
    expect(tile('Active').textContent).toContain('Active0Observed');
    expect(tile('Waiting for approval').textContent).not.toContain('oldest');
    expect(tile('AI tokens today (UTC)').textContent).toBe(
      'AI tokens today (UTC)Not yet availableView workspaces by AI use',
    );
  });
});

describe('Scenario: A read fails', () => {
  it('the AI tile says "We could not load AI use. Try again." and the other tiles still show', () => {
    show({ ai: null });
    expect(tile('AI tokens today (UTC)').textContent).toBe(
      'AI tokens today (UTC)We could not load AI use. Try again.Try again',
    );
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/ops');
    expect(tile('Active').textContent).toContain('4Observed');
    expect(tile('Catalogue version').textContent).toContain('Version 1 live');
  });
});
