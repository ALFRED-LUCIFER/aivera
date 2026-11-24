'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Label, Select } from '@credalent/ui';
import type { ComponentProps } from 'react';
import { AddApplicantsDialog } from '@/features/add-applicants';
import type { ImportView } from '../domain/importPage.ts';

// AIV-P1-101: "Bring in candidates", ported from docs/01-design/artboards/Import.dc.html. Deviations:
// - Only "Upload CVs" is offered. "Spreadsheet or job board export" (AIV-P1-103), "Forward by email" (the job's address,
//   AIV-P2-057), "From your talent pool" (AIV-P2-021, AIV-P2-022) and "From your ATS" (AIV-P6-E06) stay hidden until
//   their tickets ship (AIV-P1-095).
// - "Upload files" opens the existing "Add applicants" dialog (AIV-P1-019), which takes CVs one at a time and their
//   source; the artboard's "Check before adding" table and the "added" note are AIV-P1-102 and AIV-P1-104.
// - The footer counts the job's applications with a "Careers page" source, which is how the candidate site's applications
//   arrive (AIV-P3-008); a CV a member uploads with that source counts too.
// - With one card in the row, it keeps a card's width (max 384 px) instead of stretching across the page.
// - Card titles use the card type token (16 px) for the artboard's 15 px h3.
// - The assistant panel and the shell's search are the shell's (AIV-P0-920, AIV-P1-049), not this page's.

const uploadIcon = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 20h14" />
  </svg>
);

const infoIcon = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="mt-px size-4 flex-none"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.5" />
  </svg>
);

export type ImportSourcesProps =
  /** A hiring owner or interviewer: no upload control; the add-applicants action refuses them too. */
  | { readOnly: true }
  | {
      readOnly?: false;
      view: ImportView;
      onPick: (jobId: string) => void;
      /** The "Add applicants" dialog's state, from its controller. */
      upload: Omit<ComponentProps<typeof AddApplicantsDialog>, 'trigger'>;
    };

/** Stage 2 of a job: where its candidates come from (AIV-P1-101). */
export function ImportSources(props: ImportSourcesProps) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-section text-text">{t('import.title')}</h2>
        {props.readOnly ? (
          <p className="text-body text-text-2">{t('access.forbidden')}</p>
        ) : (
          <p className="max-w-[80ch] text-body text-text-2">{t('import.intro')}</p>
        )}
      </div>
      {!props.readOnly && <Sources {...props} />}
    </div>
  );
}

function Sources({ view, onPick, upload }: Exclude<ImportSourcesProps, { readOnly: true }>) {
  const t = useTranslations('import');
  return (
    <>
      <section className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-card border border-text bg-surface p-5 shadow-1">
        <div className="flex flex-[0_1_360px] flex-col gap-1.5">
          <Label htmlFor="import-job">{t('picker')}</Label>
          <Select id="import-job" value={view.jobId} onChange={(event) => onPick(event.target.value)}>
            {view.options.map(({ id, label }) => (
              <option key={id} value={id}>
                {t(`option.${label.key}`, label.values)}
              </option>
            ))}
          </Select>
        </div>
        <p className="flex-[1_1_300px] text-meta text-text-2">{t('note')}</p>
      </section>
      <div className="flex flex-wrap gap-4">
        <div className="flex min-w-0 max-w-sm flex-[1_1_190px] flex-col gap-2.5 rounded-card border border-border bg-surface p-5">
          <span className="grid size-8 flex-none place-items-center rounded-control bg-surface-subtle text-text-2">
            {uploadIcon}
          </span>
          <h3 className="text-card text-text">{t('upload.title')}</h3>
          <p className="flex-1 text-meta text-text-2">{t('upload.body')}</p>
          <div>
            <AddApplicantsDialog
              {...upload}
              trigger={
                <Button variant="primary" size="compact">
                  {t('upload.button')}
                </Button>
              }
            />
          </div>
        </div>
      </div>
      {view.fromListing !== null && (
        <p className="flex items-start gap-2.5 rounded-card border border-border bg-surface-subtle px-3.5 py-3 text-meta text-text-2">
          {infoIcon}
          <span>{t('fromListing', { count: view.fromListing })}</span>
        </p>
      )}
    </>
  );
}
