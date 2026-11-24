// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ImportView } from '../domain/importPage.ts';
import { ImportSources, type ImportSourcesProps } from './ImportSources.tsx';

// AIV-P1-101: every state of "Bring in candidates" from plain props. Synthetic opaque ids only.
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const SAE = '0190d4a2-0000-7000-9000-000000001031';
const SPD = '0190d4a2-0000-7000-9000-000000001035';
const view: ImportView = {
  jobId: SAE,
  options: [
    { id: SAE, label: { key: 'approvedVersion', values: { title: 'Senior AI Engineer', version: 2 } } },
    { id: SPD, label: { key: 'waiting', values: { title: 'Senior Product Designer' } } },
  ],
  fromListing: 38,
};
const upload: Extract<ImportSourcesProps, { view: ImportView }>['upload'] = {
  open: false,
  onOpenChange: vi.fn(),
  source: 'linkedin',
  onSourceChange: () => {},
  upload: { phase: 'idle' },
  accept: '.pdf,.docx',
  onSelectCv: () => {},
  cvs: [],
  canSubmit: false,
  pending: false,
  result: null,
  failure: null,
  onSubmit: () => {},
};

const show = (props: ImportSourcesProps) =>
  render(
    <IntlProvider {...intl}>
      <ImportSources {...props} />
    </IntlProvider>,
  );

describe('Bring in candidates', () => {
  it('Scenario: The page for Senior AI Engineer', () => {
    show({ view, onPick: () => {}, upload: { ...upload, onOpenChange: vi.fn() } });
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Bring in candidates');
    const picker = screen.getByRole('combobox', { name: 'Import into this job' }) as HTMLSelectElement;
    expect(picker.selectedOptions[0]?.textContent).toBe('Senior AI Engineer · rubric approved, version 2');
    expect(screen.getByRole('heading', { level: 3, name: 'Upload CVs' })).toBeTruthy();
    expect(
      screen.getByText(
        'PDF or Word, up to 200 at a time. Links to repositories, portfolios and write-ups are found automatically.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Applications from the published job listing arrive here on their own: 38 so far.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'For a job whose rubric is still waiting, people are added now and assessed once it is approved.',
        { exact: false },
      ),
    ).toBeTruthy();
  });

  it('"Upload files" opens the Add applicants dialog', async () => {
    const onOpenChange = vi.fn();
    show({ view, onPick: () => {}, upload: { ...upload, onOpenChange } });
    await userEvent.click(screen.getByRole('button', { name: 'Upload files' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('Scenario: Importing into a job whose rubric is waiting: picking it hands over its id alone', async () => {
    const onPick = vi.fn();
    show({ view, onPick, upload });
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Import into this job' }),
      'Senior Product Designer · rubric waiting for approval',
    );
    expect(onPick).toHaveBeenCalledWith(SPD);
  });

  it('Scenario: Sources that are not built are not offered', () => {
    show({ view, onPick: () => {}, upload });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Upload files']);
    for (const name of ['Connect ATS', 'Copy address', 'Choose from pool', 'Import file'])
      expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('a job that is not published has no line about its listing', () => {
    show({ view: { ...view, fromListing: null }, onPick: () => {}, upload });
    expect(screen.queryByText(/published job listing/)).toBeNull();
  });

  it('Scenario: An interviewer cannot bring candidates in: the message, and no upload control or picker', () => {
    show({ readOnly: true });
    expect(screen.getByText('You do not have access to this. Ask your workspace admin.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
