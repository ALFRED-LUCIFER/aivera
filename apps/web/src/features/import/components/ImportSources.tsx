'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card, Label, Select, UploadIcon } from '@credalent/ui';
import type { ComponentProps, ReactNode } from 'react';
import { AddApplicantsDialog } from '@/features/add-applicants';
import type { ImportView } from '../domain/importPage.ts';

// AIV-P1-101: "Bring in candidates", ported from docs/01-design/artboards/Import.dc.html, now titled "Add CVs", the
// action's one name (AIV-P1-165). Deviations:
// - The title, the card's "Upload CVs" (now "From CV files") and its "Upload files" button read "Add CVs" (AIV-P1-165).
// - The intro's "warns you before you submit someone a client has already seen" shows in an agency workspace only.
// - Only the CV card is offered. "Spreadsheet or job board export" (AIV-P1-103) is reached from the Add CVs dialog's
//   "From a CSV or Excel file" link, so Add CVs stays the one entry (AIV-P1-165). "Forward by email" (the job's address,
//   AIV-P2-057), "From your talent pool" (AIV-P2-021, AIV-P2-022) and "From your ATS" (AIV-P6-E06) stay hidden until
//   their tickets ship (AIV-P1-095).
// - "Add CVs" opens the Add CVs dialog (AIV-P1-019, AIV-P1-165), several CVs per pick, 200 per save; the artboard's
//   "Check before adding" table and the "added" note are AIV-P1-102 and AIV-P1-104.
// - The footer "Applications from the published job listing arrive here on their own: N so far" stays hidden until
//   candidate-site applications arrive (AIV-P3-008): today only a member's own upload writes a careers-page source, so
//   the count would not be what it says (AGENTS.md 1.7).
// - The picker says under its label that choosing a job opens its page (WCAG 3.2.2): the artboard draws no hint.
// - With one card in the row, it keeps a card's width (max 384 px) instead of stretching across the page.
// - Card titles use the card type token (16 px) for the artboard's 15 px h3.
// - Both cards are the shared Card, so they have its 16 px padding and shadow, and the picker card its border colour,
//   where the artboard draws 20 px padding, no shadow and an ink border on the picker card (AGENTS.md section 4: never
//   a local copy of a shared component).
// - The assistant panel and the shell's search are the shell's (AIV-P0-920, AIV-P1-049), not this page's.

export type ImportSourcesProps =
  /** A hiring owner or interviewer: no upload control; the add-applicants action refuses them too. */
  | { readOnly: true }
  | {
      readOnly?: false;
      view: ImportView;
      /** An agency workspace: the intro names the client check. */
      agency: boolean;
      onPick: (jobId: string) => void;
      /** The Add CVs dialog's state, from its controller. */
      upload: Omit<ComponentProps<typeof AddApplicantsDialog>, 'trigger'>;
    };

/** Stage 2 of a job: where its candidates come from (AIV-P1-101). */
export function ImportSources(props: ImportSourcesProps) {
  const t = useTranslations();
  return (
    <Frame intro={props.readOnly ? t('access.forbidden') : t(props.agency ? 'import.introAgency' : 'import.intro')}>
      {!props.readOnly && <Sources {...props} />}
    </Frame>
  );
}

/** loading.tsx: the frame, and a card announcing the load. */
export function ImportLoading() {
  const t = useTranslations('import');
  return (
    <Frame intro={t('intro')}>
      <Card loading loadingLabel={t('loading')} />
    </Frame>
  );
}

/** error.tsx: the page could not be read; the frame stays, with a way to try again. */
export function ImportFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('import');
  return (
    <Frame intro={t('intro')}>
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-body text-text">
          {t('failed')}
        </p>
        <Button onClick={onRetry}>{t('retry')}</Button>
      </div>
    </Frame>
  );
}

function Frame({ intro, children }: { intro: string; children: ReactNode }) {
  const t = useTranslations('import');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-section text-text">{t('title')}</h2>
        <p className="max-w-[80ch] text-body text-text-2">{intro}</p>
      </div>
      {children}
    </div>
  );
}

function Sources({ view, onPick, upload }: Exclude<ImportSourcesProps, { readOnly: true }>) {
  const t = useTranslations('import');
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex flex-[0_1_360px] flex-col gap-1.5">
            <Label htmlFor="import-job">{t('picker')}</Label>
            <p id="import-job-hint" className="text-meta text-text-2">
              {t('pickerHint')}
            </p>
            <Select
              id="import-job"
              aria-describedby="import-job-hint"
              value={view.jobId}
              onChange={(event) => onPick(event.target.value)}
            >
              {view.options.map(({ id, label }) => (
                <option key={id} value={id}>
                  {t(`option.${label.key}`, label.values)}
                </option>
              ))}
            </Select>
          </div>
          <p className="flex-[1_1_300px] text-meta text-text-2">{t('note')}</p>
        </div>
      </Card>
      <div className="flex flex-wrap gap-4">
        <Card className="min-w-0 max-w-sm flex-[1_1_190px]">
          <div className="flex flex-col gap-2.5">
            <span className="grid size-8 flex-none place-items-center rounded-control bg-surface-subtle text-text-2">
              <UploadIcon className="size-4 stroke-[1.75]" />
            </span>
            <h3 className="text-card text-text">{t('upload.title')}</h3>
            <p className="text-meta text-text-2">{t('upload.body')}</p>
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
        </Card>
      </div>
    </>
  );
}
