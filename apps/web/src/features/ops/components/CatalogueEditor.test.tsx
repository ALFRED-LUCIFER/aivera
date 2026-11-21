// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import type { EditorVersion } from '@credalent/jobs';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CATALOGUE_V1 } from '@/test/catalogue-v1.ts';
import {
  draftModel,
  newCompetencyForm,
  newJobTypeForm,
  newPackForm,
  packFormFor,
  type DraftModel,
  type EditorViewModel,
  type Refusal,
} from '../domain/catalogueEditor.ts';
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
    hints: p.hints.map((h, i) => ({ ...h, position: p.hints.slice(0, i).filter((o) => o.region === h.region).length })),
  })),
};
const payments = v1.packs[0] as EditorVersion['packs'][number];
const draft = {
  ...v1,
  // AIV-P2-047: a retired published job type and one new in the draft, placed second.
  jobTypes: [
    ...v1.jobTypes.slice(0, 1),
    {
      key: 'security_engineering',
      label: { en: 'Security engineering' },
      evidence: { en: 'Threat models, security reviews, fixed vulnerabilities' },
      starterCompetencies: ['Threat modelling', 'Secure code review', 'Incident response', 'Identity and access'],
      retired: false,
    },
    ...v1.jobTypes.slice(1).map((t) => ({ ...t, retired: t.key === 'technical_writing_support' })),
  ],
  version: 2,
  status: 'draft' as const,
  revision: 5,
  revisedBy: null,
  revisedAt: new Date('2026-11-21T08:00:00Z'),
  packs: [
    {
      ...payments,
      competencies: payments.competencies.map((c, i) => ({ ...c, retired: i === 0 })),
    },
    // Logistics: its first hint retired. Telecom: no hints for India in the draft (AIV-P2-046).
    ...v1.packs
      .slice(1)
      .map((p) =>
        p.key === 'logistics_mobility'
          ? { ...p, hints: p.hints.map((h, i) => ({ ...h, retired: i === 0 })) }
          : p.key === 'telecom'
            ? { ...p, hints: p.hints.filter((h) => h.region !== 'india') }
            : p,
      ),
    { key: 'insurance', label: { en: 'Insurance and insurtech' }, retired: false, hints: [], competencies: [] },
  ],
};
const model = draftModel({ published: v1, draft }) as DraftModel;
// The whole draft renders ~1,900 nodes, which took over 5 s a test on a busy CI runner: a test renders only the packs
// it reads (none by default; the forms and the job type and region lists need none).
const withPacks = (from: DraftModel, ...keys: string[]): DraftModel => ({
  ...from,
  packs: from.packs.filter((p) => keys.includes(p.key)),
});

const viewModel = (patch: Partial<EditorViewModel> = {}): EditorViewModel => ({
  draft: withPacks(model),
  packForm: null,
  competencyForm: null,
  jobTypeForm: null,
  error: null,
  pending: false,
  onAddPack: vi.fn(),
  onEditPack: vi.fn(),
  onPackChange: vi.fn(),
  onAddRegion: vi.fn(),
  onEditRegion: vi.fn(),
  onRetireRegion: vi.fn(async () => {}),
  onAddCompetency: vi.fn(),
  onEditCompetency: vi.fn(),
  onAddHint: vi.fn(),
  onEditHint: vi.fn(),
  onRetireHint: vi.fn(async () => {}),
  onCompetencyChange: vi.fn(),
  onToggleJobType: vi.fn(),
  onAddJobType: vi.fn(),
  onEditJobType: vi.fn(),
  onJobTypeChange: vi.fn(),
  onRetireJobType: vi.fn(async () => {}),
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
    // Every pack, without its entries: the summaries are all this reads, and a pack's status comes from draftModel.
    const packs = model.packs.map((p) => ({ ...p, competencies: [], hints: [] }));
    show(<CatalogueEditor publishedVersion={1} view={viewModel({ draft: { ...model, packs } })} />);
    expect(screen.getByText('Draft — not live. Recruiters see version 1.')).toBeTruthy();
    const summaries = [...document.querySelectorAll('summary')];
    expect(summaries).toHaveLength(9);
    // A pack's status is its own fields: a retired competency inside leaves Payments and fintech "Live".
    expect(summaries.slice(0, 8).every((s) => s.textContent?.includes('Live'))).toBe(true);
    expect(summaries[8]?.textContent).toContain('New in draft');
  });

  it('Scenario: A published competency is retired: "Retired" and no delete control for it', () => {
    show(
      <CatalogueEditor
        publishedVersion={1}
        view={viewModel({ draft: withPacks(model, 'payments_fintech', 'insurance') })}
      />,
    );
    const name = payments.competencies[0]?.name ?? '';
    const row = screen.getByText(name, { selector: 'h3' }).closest('li') as HTMLElement;
    expect(within(row).getByText('Retired')).toBeTruthy();
    expect(within(row).queryAllByRole('button')).toEqual([]);
    // A live published one is retired, not removed; a new pack is removed, not retired.
    expect(screen.getByLabelText(`Retire ${payments.competencies[1]?.name}`)).toBeTruthy();
    expect(screen.queryByLabelText(`Remove ${payments.competencies[1]?.name}`)).toBeNull();
    expect(screen.getByLabelText('Remove Insurance and insurtech')).toBeTruthy();
    expect(screen.getByLabelText('Retire Payments and fintech')).toBeTruthy();
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

// AIV-P2-046: regional hints in the draft.
const packDetails = (label: string) =>
  [...document.querySelectorAll('details')].find((d) =>
    d.querySelector('summary')?.textContent?.includes(label),
  ) as HTMLElement;
const regionSection = (pack: HTMLElement, heading: string) =>
  within(pack).getByRole('heading', { level: 3, name: heading }).closest('section') as HTMLElement;

describe('Feature: Edit regional hints in a catalogue draft', () => {
  it('Scenario: Empty state: "No regional hints for India yet." with a way to add one', async () => {
    const view = viewModel({ draft: withPacks(model, 'telecom') });
    show(<CatalogueEditor publishedVersion={1} view={view} />);
    const india = regionSection(packDetails('Telecom'), 'Regional hints for India');
    expect(within(india).getByText('No regional hints for India yet.')).toBeTruthy();
    await userEvent.click(within(india).getByRole('button', { name: 'Add a regional hint to Telecom for India' }));
    expect(view.onAddHint).toHaveBeenCalledWith('telecom', 'india');
  });

  it('Scenario: A published hint is retired: "Retired" with no controls; a live one is retired, not removed', () => {
    show(<CatalogueEditor publishedVersion={1} view={viewModel({ draft: withPacks(model, 'logistics_mobility') })} />);
    const uae = regionSection(packDetails('Logistics and mobility'), 'Regional hints for the UAE');
    const retired = within(uae).getByRole('listitem');
    expect(within(retired).getByText('Retired')).toBeTruthy();
    expect(within(retired).queryAllByRole('button')).toEqual([]);
    const ksa = regionSection(packDetails('Logistics and mobility'), 'Regional hints for KSA');
    expect(within(ksa).getByText('Live')).toBeTruthy();
    expect(within(ksa).getByText('Desirable')).toBeTruthy();
    expect(within(ksa).getByRole('button', { name: 'Retire FASAH customs platform' })).toBeTruthy();
    expect(within(ksa).queryByRole('button', { name: 'Remove FASAH customs platform' })).toBeNull();
  });

  it('Scenario: A hint cannot be made mandatory: Desirable, no Mandatory option, no default suggestions', () => {
    show(
      <CatalogueEditor
        publishedVersion={1}
        view={viewModel({ competencyForm: newCompetencyForm('logistics_mobility', 'ksa') })}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add a regional hint' });
    expect(within(dialog).getByText('Desirable', { selector: 'dd' })).toBeTruthy();
    expect(within(dialog).queryByText(/mandatory/i, { selector: 'label, option, button' })).toBeNull();
    expect(within(dialog).queryByRole('group', { name: 'Default suggestion for' })).toBeNull();
    expect(within(dialog).getByRole('group', { name: 'Applies to job types' })).toBeTruthy();
  });

  it('the residency refusal shows under the name; a failed save says nothing was changed', () => {
    const form = { ...newCompetencyForm('logistics_mobility', 'ksa'), name: 'Must hold a UAE residence visa' };
    show(
      <CatalogueEditor
        publishedVersion={1}
        view={viewModel({ competencyForm: form, error: { ok: false, error: 'fairness_residency', field: 'name' } })}
      />,
    );
    const name = screen.getByLabelText('Name');
    expect(document.getElementById(name.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'A regional hint is market knowledge shown with evidence, never where someone lives or is from.',
    );
    cleanup();
    show(
      <CatalogueEditor
        publishedVersion={1}
        view={viewModel({ competencyForm: form, error: { ok: false, error: 'failed' } })}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('That did not go through. Nothing was changed.');
  });
});

const jobTypes = () => screen.getByRole('list', { name: 'Job types in the draft' });

describe('job types in the draft (AIV-P2-047)', () => {
  it('Scenario: Adding a job type: "New in draft" at the position chosen; recruiters\' list is not this one', () => {
    show(<CatalogueEditor publishedVersion={1} view={viewModel()} />);
    const rows = within(jobTypes()).getAllByRole('listitem');
    expect(rows).toHaveLength(11);
    expect(rows[1]?.textContent).toContain('Security engineering');
    expect(rows[1]?.textContent).toContain('New in draft');
    expect(rows[1]?.textContent).toContain('Starter competencies: Threat modelling, Secure code review');
    expect(rows[0]?.textContent).toContain('Live');
    expect(screen.getByRole('button', { name: 'Remove Security engineering' })).toBeTruthy();
  });

  it('Scenario: A published job type is retired, never deleted: "Retired" and no controls', () => {
    show(<CatalogueEditor publishedVersion={1} view={viewModel()} />);
    const row = within(jobTypes())
      .getByRole('heading', { level: 3, name: 'Technical writing and support' })
      .closest('li') as HTMLElement;
    expect(within(row).getByText('Retired')).toBeTruthy();
    expect(within(row).queryAllByRole('button')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Retire Software engineering' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Software engineering' })).toBeNull();
  });

  it('Scenario: A job type needs exactly four starters: the refusal shows under the starters', () => {
    const form = { ...newJobTypeForm(model), starters: ['a', 'b', 'c', ''] };
    show(
      <CatalogueEditor
        publishedVersion={1}
        view={viewModel({ jobTypeForm: form, error: { ok: false, error: 'invalid', field: 'starters' } })}
      />,
    );
    const group = screen.getByRole('group', { name: 'Starter competencies' });
    expect(within(group).getByRole('alert').textContent).toBe('Add exactly four starter competencies.');
    expect(screen.getByLabelText('Starter competency 4').getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByLabelText('Position in Add a job') as HTMLInputElement).value).toBe('11');
  });

  it('Scenario: Error: "That did not go through. Nothing was changed."', () => {
    show(
      <CatalogueEditor
        publishedVersion={1}
        view={viewModel({ jobTypeForm: newJobTypeForm(model), error: { ok: false, error: 'failed' } })}
      />,
    );
    expect(screen.getByRole('dialog').querySelector('[role="alert"]')?.textContent).toBe(
      'That did not go through. Nothing was changed.',
    );
  });
});

// AIV-P2-059: India retired, EU new in the draft.
const regionsModel = draftModel({
  published: v1,
  draft: {
    ...draft,
    regions: [
      ...v1.regions.map((r) => ({ ...r, retired: r.key === 'india' })),
      { key: 'eu', label: { en: 'EU' }, retired: false },
    ],
  },
}) as DraftModel;
const regionList = () => screen.getByRole('list', { name: 'Regions in the draft' });
const regionRow = (label: string) =>
  within(regionList()).getByText(label, { selector: 'h3' }).closest('li') as HTMLElement;

const regionForm = (error: Refusal) => (
  <IntlProvider {...intl}>
    <CatalogueEditor
      publishedVersion={1}
      view={viewModel({ draft: withPacks(regionsModel), packForm: newPackForm('region'), error })}
    />
  </IntlProvider>
);

describe('Feature: Add and retire regions in a catalogue draft (AIV-P2-059)', () => {
  it('Scenario: Adding a region: "EU" shows "New in draft" and each pack shows its empty hint section', async () => {
    const onAddRegion = vi.fn();
    show(
      <CatalogueEditor
        publishedVersion={1}
        view={viewModel({ draft: withPacks(regionsModel, 'payments_fintech'), onAddRegion })}
      />,
    );
    expect(within(regionRow('EU')).getByText('New in draft')).toBeTruthy();
    expect(within(regionRow('EU')).getByRole('button', { name: 'Remove EU' })).toBeTruthy();
    const paymentsPack = document.querySelector('details') as HTMLElement;
    expect(within(paymentsPack).getByText('Regional hints for EU')).toBeTruthy();
    expect(within(paymentsPack).getByText('No regional hints for EU yet.')).toBeTruthy();
    expect(within(paymentsPack).getByRole('button', { name: /Add a regional hint to .* for EU/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add a region' }));
    expect(onAddRegion).toHaveBeenCalledOnce();
  });

  it('Scenario: Retiring a region keeps its hints visible as retired, with no edit, delete or add control', () => {
    show(
      <CatalogueEditor publishedVersion={1} view={viewModel({ draft: withPacks(regionsModel, 'payments_fintech') })} />,
    );
    const india = regionRow('India');
    expect(within(india).getByText('Retired')).toBeTruthy();
    expect(within(india).queryByRole('button')).toBeNull();
    const paymentsPack = document.querySelector('details') as HTMLElement;
    const section = within(paymentsPack).getByText('Regional hints for India').closest('section') as HTMLElement;
    const upi = within(section).getByText('UPI and NPCI rules', { selector: 'h3' }).closest('li') as HTMLElement;
    expect(within(upi).getByText('Retired')).toBeTruthy();
    expect(within(section).queryByRole('button')).toBeNull();
  });

  it('Scenario: A published region key cannot be renamed: its form has a read-only key, only its label to edit', () => {
    const ksa = regionsModel.regions.find((r) => r.key === 'ksa');
    if (!ksa) throw new Error('no ksa');
    // A published region is retired, never removed.
    show(<CatalogueEditor publishedVersion={1} view={viewModel({ draft: withPacks(regionsModel) })} />);
    expect(within(regionRow('KSA')).getByRole('button', { name: 'Retire KSA' })).toBeTruthy();
    cleanup();
    show(
      <CatalogueEditor
        publishedVersion={1}
        view={viewModel({ draft: withPacks(regionsModel), packForm: packFormFor(ksa, 'region') })}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit region' });
    expect(within(dialog).getByLabelText('Key').hasAttribute('readonly')).toBe(true);
    expect(within(dialog).getByLabelText('English label').hasAttribute('readonly')).toBe(false);
  });

  it('the region refusals read as the ticket says, under their fields', () => {
    // One open form, re-rendered with each refusal rather than mounted six times.
    const { rerender } = render(regionForm({ ok: false, error: 'failed' }));
    const refusedRegion = (error: Refusal) => {
      rerender(regionForm(error));
      return within(screen.getByRole('dialog', { name: 'Add a region' })).getByRole('alert').textContent;
    };
    expect(refusedRegion({ ok: false, error: 'invalid', field: 'key' })).toBe(
      'Use lower-case letters, digits and underscores for the key.',
    );
    expect(refusedRegion({ ok: false, error: 'key_taken', field: 'key' })).toBe(
      'That key is already in the catalogue.',
    );
    expect(refusedRegion({ ok: false, error: 'invalid', field: 'label' })).toBe('Add an English label.');
    expect(refusedRegion({ ok: false, error: 'fairness_region', field: 'label' })).toBe(
      'A region is a market whose rules a candidate can show skill in, never where someone lives or is from.',
    );
    expect(refusedRegion({ ok: false, error: 'failed' })).toBe('That did not go through. Nothing was changed.');
    expect(refusedRegion({ ok: false, error: 'stale', by: 'Theo Platform' })).toContain(
      'Theo Platform changed this draft. Reload to see the latest.',
    );
  });
});
