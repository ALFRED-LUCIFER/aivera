// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import type { EditorVersion } from '@credalent/jobs';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CATALOGUE_V1 } from '@/test/catalogue-v1.ts';
import { draftModel, newCompetencyForm, type EditorViewModel, type Refusal } from '../domain/catalogueEditor.ts';
import { CatalogueEditor, StartDraft } from './CatalogueEditor.tsx';

// AIV-P2-045: the catalogue editor's states, statuses and refusals. Synthetic catalogue text only.
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});
const show = (node: ReactNode) => render(<IntlProvider {...intl}>{node}</IntlProvider>);

const v1: EditorVersion = {
  ...CATALOGUE_V1,
  packs: CATALOGUE_V1.packs.map((p) => ({
    ...p,
    competencies: p.competencies.map((c, position) => ({ ...c, position })),
  })),
};
const payments = v1.packs[0] as EditorVersion['packs'][number];
const draft = {
  ...v1,
  version: 2,
  status: 'draft' as const,
  revision: 5,
  revisedBy: null,
  packs: [
    {
      ...payments,
      competencies: payments.competencies.map((c, i) => ({ ...c, retired: i === 0 })),
    },
    ...v1.packs.slice(1),
    { key: 'insurance', label: { en: 'Insurance and insurtech' }, retired: false, hints: [], competencies: [] },
  ],
};
const model = draftModel({ published: v1, draft });

const viewModel = (patch: Partial<EditorViewModel> = {}): EditorViewModel => ({
  draft: model ?? { revision: 0, jobTypes: [], packs: [] },
  packForm: null,
  competencyForm: null,
  error: null,
  pending: false,
  onAddPack: vi.fn(),
  onEditPack: vi.fn(),
  onPackChange: vi.fn(),
  onAddCompetency: vi.fn(),
  onEditCompetency: vi.fn(),
  onCompetencyChange: vi.fn(),
  onToggleJobType: vi.fn(),
  onSave: vi.fn(async () => {}),
  onClose: vi.fn(),
  onReload: vi.fn(),
  onRetire: vi.fn(async () => {}),
  ...patch,
});

describe('Scenario Outline: Page states', () => {
  it('no draft exists: "Recruiters see version 1. Start a draft to change it."', async () => {
    const onStart = vi.fn();
    show(<StartDraft version={1} pending={false} error={null} onStart={onStart} />);
    expect(screen.getByText('Recruiters see version 1. Start a draft to change it.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Start a draft' }));
    expect(onStart).toHaveBeenCalledOnce();
  });
});

describe('the draft', () => {
  it('Scenario: Starting a draft: the banner and the 8 published packs "Live", a new pack "New in draft"', () => {
    show(<CatalogueEditor publishedVersion={1} view={viewModel()} />);
    expect(screen.getByText('Draft — not live. Recruiters see version 1.')).toBeTruthy();
    const summaries = [...document.querySelectorAll('summary')];
    expect(summaries).toHaveLength(9);
    // A pack's status is its own fields: a retired competency inside leaves Payments and fintech "Live".
    expect(summaries.slice(0, 8).every((s) => s.textContent?.includes('Live'))).toBe(true);
    expect(summaries[8]?.textContent).toContain('New in draft');
  });

  it('Scenario: A published competency is retired: "Retired" and no delete control for it', () => {
    show(<CatalogueEditor publishedVersion={1} view={viewModel()} />);
    const name = payments.competencies[0]?.name ?? '';
    const row = screen.getByRole('heading', { level: 3, name }).closest('li') as HTMLElement;
    expect(within(row).getByText('Retired')).toBeTruthy();
    expect(within(row).queryAllByRole('button')).toEqual([]);
    // A live published one is retired, not removed; a new pack is removed, not retired.
    expect(screen.getByRole('button', { name: `Retire ${payments.competencies[1]?.name}` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: `Remove ${payments.competencies[1]?.name}` })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Insurance and insurtech' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retire Payments and fintech' })).toBeTruthy();
  });

  it('a fairness refusal shows under the field it names, never the refused text elsewhere', () => {
    const error: Refusal = { ok: false, error: 'fairness_origin', field: 'name' };
    show(
      <CatalogueEditor
        publishedVersion={1}
        view={viewModel({
          competencyForm: { ...newCompetencyForm('insurance'), name: 'UAE nationals preferred' },
          error,
        })}
      />,
    );
    const name = screen.getByLabelText('Name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    const message = document.getElementById(name.getAttribute('aria-describedby') ?? '');
    expect(message?.textContent).toBe(
      'A competency is a skill with evidence, never a nationality or where someone is from.',
    );
    expect(screen.getByText('Desirable', { selector: 'dd' })).toBeTruthy();
  });

  it('Scenario: A stale save: "Theo Platform changed this draft. Reload to see the latest."', async () => {
    const view = viewModel({ error: { ok: false, error: 'stale', by: 'Theo Platform' } });
    show(<CatalogueEditor publishedVersion={1} view={view} />);
    expect(screen.getByRole('alert').textContent).toContain(
      'Theo Platform changed this draft. Reload to see the latest.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(view.onReload).toHaveBeenCalledOnce();
  });

  it('the core limit refusal names the rule under the default suggestions', () => {
    show(
      <CatalogueEditor
        publishedVersion={1}
        view={viewModel({
          competencyForm: newCompetencyForm('insurance'),
          error: { ok: false, error: 'core_limit', field: 'core' },
        })}
      />,
    );
    const group = screen.getByRole('group', { name: 'Default suggestion for' });
    expect(within(group).getByRole('alert').textContent).toBe('At most 4 default suggestions per job type in a pack.');
  });
});
