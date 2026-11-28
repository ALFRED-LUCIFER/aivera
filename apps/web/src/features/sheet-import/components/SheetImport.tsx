'use client';

import { useTranslations } from '@credalent/i18n/react';
import {
  Button,
  Card,
  Checkbox,
  DataTable,
  FilePicker,
  Label,
  PreviewBanner,
  Select,
  SuccessBanner,
  type DataTableColumn,
} from '@credalent/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { RIGHT_TO_PROCESS_KEY } from '@/features/add-applicants/domain/addApplicants.ts';
import type { DirectUpload } from '@/features/files';
import {
  FIELDS,
  peopleOf,
  type SheetActionError,
  type SheetField,
  type SheetImportView,
} from '../domain/sheetImport.ts';

// AIV-P1-103: "Spreadsheet or job board export" on Bring in candidates (docs/01-design/artboards/Import.dc.html draws
// only its card: "A CSV or Excel file with a name, email and CV link per row. Credalent maps the columns for you." and
// "Import file"). No artboard draws the steps after it, so they are built from the shared Card, FilePicker, Select,
// DataTable, Checkbox and PreviewBanner. Deviations:
// - the card's entry on the Bring in candidates page is the session lead's (it links here); this page repeats its copy;
// - the check before adding is this ticket's part of AIV-P1-102: the people to add with source "Spreadsheet" and each
//   unusable row by its number only; duplicate merging and "already submitted to this client" stay with AIV-P1-102;
// - the confirmation above the add button is AIV-P1-104's, as in "Add applicants".

/** The page's state and handlers, from useSheetImportController. */
export type SheetImportStepProps = {
  jobTitle: string;
  view: SheetImportView | null;
  upload: DirectUpload;
  accept: string;
  onSelectFile: (file: File) => void;
  mapping: SheetImportView['mapping'] | null;
  onMappingChange: (field: SheetField, column: number | null) => void;
  canConfirmMapping: boolean;
  onConfirmMapping: () => void;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  /** Rejects on a refusal, so the preview says nothing changed. */
  onAdd: () => Promise<void>;
  onStartOver: () => void;
  pending: boolean;
  error: SheetActionError | null;
};

type Props = { readOnly: true } | ({ readOnly?: false } & SheetImportStepProps);

export function SheetImport(props: Props) {
  const t = useTranslations('sheetImport');
  const tAccess = useTranslations('access');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-section text-text">{t('title')}</h2>
        <p className="max-w-[80ch] text-body text-text-2">{props.readOnly ? tAccess('forbidden') : t('intro')}</p>
      </div>
      {!props.readOnly && <Step {...props} />}
    </div>
  );
}

function Step(p: Exclude<Props, { readOnly: true }>) {
  const t = useTranslations('sheetImport');
  const view = p.view;
  const added = view?.status === 'added' ? peopleOf(view).length : null;
  return (
    <>
      {/* Mounted empty on every step, so the message is announced when it arrives (SuccessBanner). */}
      <SuccessBanner>{added !== null && t('added', { count: added, title: p.jobTitle })}</SuccessBanner>
      {!view ? (
        <Choose {...p} />
      ) : view.status === 'reading' || view.status === 'fetching' ? (
        <Card>
          <output className="text-body text-text">{t(view.status)}</output>
        </Card>
      ) : view.status === 'unreadable' ? (
        <Card>
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-body text-text">
              {t(view.problem === 'too_many_rows' ? 'tooManyRows' : 'unreadable')}
            </p>
            <Button onClick={p.onStartOver}>{t('another')}</Button>
          </div>
        </Card>
      ) : view.status === 'mapping' ? (
        <Mapping {...p} view={view} />
      ) : view.status === 'ready' ? (
        <Check {...p} view={view} />
      ) : (
        <Link href={`/app/jobs/${view.jobId}/candidates`} className="text-body text-action underline">
          {t('toCandidates')}
        </Link>
      )}
    </>
  );
}

function Choose(p: Exclude<Props, { readOnly: true }>) {
  const t = useTranslations('sheetImport');
  const tFiles = useTranslations('files');
  const { upload } = p;
  return (
    <Card>
      <FilePicker
        label={t('choose')}
        hint={t('hint')}
        accept={p.accept}
        onSelect={(files) => files[0] && p.onSelectFile(files[0])}
        disabled={upload.phase === 'uploading' || upload.phase === 'checking' || p.pending}
        progress={upload.phase === 'uploading' ? upload.percent : null}
        status={
          upload.phase === 'uploading'
            ? tFiles('uploading', { percent: upload.percent })
            : upload.phase === 'checking' || p.pending
              ? t('checking')
              : null
        }
        error={upload.phase === 'error' ? tFiles(upload.message) : p.error && t(`errors.${p.error}`)}
      />
    </Card>
  );
}

function Mapping(p: Exclude<Props, { readOnly: true }> & { view: SheetImportView }) {
  const t = useTranslations('sheetImport.mapping');
  const tErrors = useTranslations('sheetImport.errors');
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-card text-text">{t('title')}</h3>
          <p className="text-meta text-text-2">{t('intro')}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map(({ field, required }) => (
            <div key={field} className="flex flex-col gap-1.5">
              <Label htmlFor={`sheet-${field}`}>{t(`fields.${field}`)}</Label>
              <Select
                id={`sheet-${field}`}
                required={required}
                value={String(p.mapping?.[field] ?? '')}
                onChange={(event) =>
                  p.onMappingChange(field, event.target.value === '' ? null : Number(event.target.value))
                }
              >
                <option value="">{required ? t('choose') : t('none')}</option>
                {p.view.headers.map((header, column) => (
                  // Column positions are the values: two columns may share a name.
                  // oxlint-disable-next-line react/no-array-index-key -- the column's position is its identity here
                  <option key={column} value={column}>
                    {header || t('unnamed', { column: column + 1 })}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
        {p.error && (
          <p role="alert" className="text-body text-err-text">
            {tErrors(p.error)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!p.canConfirmMapping} onClick={p.onConfirmMapping}>
            {t('confirm')}
          </Button>
          <Button variant="ghost" onClick={p.onStartOver}>
            {t('another')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

type Person = Extract<SheetImportView['rows'][number], { problem: null }>;

function Check(p: Exclude<Props, { readOnly: true }> & { view: SheetImportView }) {
  const t = useTranslations('sheetImport.check');
  const tSheet = useTranslations('sheetImport');
  const tc = useTranslations();
  const people = peopleOf(p.view) as Person[];
  const notes = p.view.rows.flatMap((r): { row: number; message: ReactNode }[] =>
    r.problem !== null
      ? [{ row: r.row, message: tSheet(`problems.${r.problem}`) }]
      : r.cv === 'unreadable'
        ? [{ row: r.row, message: tSheet('problems.cv_unreadable') }]
        : [],
  );
  const columns: DataTableColumn<Person>[] = [
    { id: 'row', header: t('row'), cell: (r) => r.row, numeric: true },
    { id: 'name', header: t('name'), cell: (r) => r.name },
    { id: 'email', header: t('email'), cell: (r) => r.email },
    { id: 'source', header: t('source'), cell: () => tSheet('spreadsheet') },
    { id: 'cv', header: t('cv'), cell: (r) => t(`cvState.${r.cv}`) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-card text-text">{t('title')}</h3>
      <DataTable
        caption={t('caption', { count: people.length })}
        columns={columns}
        rows={people}
        getRowId={(r) => String(r.row)}
        emptyMessage={t('nobody')}
      />
      {notes.length > 0 && (
        <section aria-labelledby="sheet-notes" className="flex flex-col gap-2">
          <h4 id="sheet-notes" className="text-meta font-semibold text-text">
            {t('notes')}
          </h4>
          <ul className="flex flex-col gap-1">
            {notes.map(({ row, message }) => (
              <li key={row} className="text-body text-text">
                {t('noteRow', { row })} {message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {people.length > 0 ? (
        <PreviewBanner
          title={t('previewTitle', { count: people.length, title: p.jobTitle })}
          confirmLabel={t('submit', { count: people.length })}
          pendingLabel={t('adding')}
          confirmDisabled={!p.confirmed}
          cancelLabel={tSheet('another')}
          footer={t('footer')}
          errorMessage={t('error')}
          onConfirm={p.onAdd}
          onCancel={p.onStartOver}
        >
          <Checkbox
            checked={p.confirmed}
            onChange={(event) => p.onConfirmedChange(event.target.checked)}
            label={tc(RIGHT_TO_PROCESS_KEY, { title: p.jobTitle })}
          />
        </PreviewBanner>
      ) : (
        <div>
          <Button onClick={p.onStartOver}>{tSheet('another')}</Button>
        </div>
      )}
    </div>
  );
}
