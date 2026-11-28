'use client';

import { useTranslations } from '@credalent/i18n/react';
import {
  Button,
  buttonClassName,
  Checkbox,
  Dialog,
  DialogClose,
  FilePicker,
  RadioGroup,
  SuccessBanner,
  UploadIcon,
} from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { RIGHT_TO_PROCESS_KEY, SOURCE_OPTIONS, type AddApplicantsResult, type CvRow } from '../domain/addApplicants.ts';

// AIV-P1-019, AIV-P1-165: "Add CVs" (source, several CVs per pick). No artboard draws this dialog: the Import artboard
// only names the "Upload CVs" card that opens it. Built from the shared Dialog, RadioGroup and FilePicker (whose control
// is the CApply artboard's "Upload CV"). Deviations, since there is nothing to port:
// - each file is listed by its name with its own result (waiting, uploading, checking, ready, not added and why, added);
//   the Candidates tab's applicant list (AIV-P1-086) shows the new rows behind it;
// - past 200 per save, the rest of the pick is left out and one line says how many and why;
// - after a save, with nothing new waiting, the one primary button is "Go to ranking".
// AIV-P1-104: the confirmation checkbox above the add button, from the Import artboard's "Check before adding" footer. Not
// built from that artboard (AIV-P1-102 builds the check): its Consent column ("Consent recorded", "Consent not yet
// given"), the summary clause "1 has not given consent yet" and the footnote "People without consent are added but not
// assessed until they agree" are dropped, because nobody is held back one by one. The button says "Add N CVs", the
// action's one name (AIV-P1-165), for the artboard's "Add N people to this job".

export type AddApplicantsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** '' until the recruiter chooses: there is no default source. */
  source: string;
  onSourceChange: (source: string) => void;
  accept: string;
  onSelectCvs: (files: File[]) => void;
  rows: CvRow[];
  /** How many files of the last pick were left out by the 200 per save. */
  over: number;
  readyCount: number;
  /** The job's title, named in the confirmation line. */
  jobTitle: string;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  canSubmit: boolean;
  pending: boolean;
  result: AddApplicantsResult | null;
  /** The save threw; the CVs and source stay. A key under `access`. */
  failure: 'saveFailed' | 'saveForbidden' | null;
  onSubmit: () => void;
  /** Set once a save added CVs and nothing new waits: "Go to ranking" becomes the primary button. */
  rankingHref: string | null;
  /** The button that opens the dialog; by default "Add CVs" with the Rubric artboard's upload arrow. */
  trigger?: ReactNode;
};

/** Status colour always travels with an icon and words (DESIGN.md): the FilePicker's error icon. */
const errorIcon = (
  <svg
    aria-hidden="true"
    viewBox="0 0 16 16"
    className="size-4 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 4.75v3.75M8 10.75v.5" strokeLinecap="round" />
  </svg>
);

export function AddApplicantsDialog(props: AddApplicantsDialogProps) {
  const t = useTranslations('addApplicants');
  const tf = useTranslations('files');
  const ta = useTranslations('access');
  const tc = useTranslations();
  const hintId = useId();
  const { result, rows } = props;
  const error = props.failure
    ? ta(props.failure)
    : result && !result.ok
      ? result.error === 'jobNotFound' || result.error === 'confirmationRequired'
        ? t(result.error)
        : tf(result.error)
      : null;
  const hint = !props.source ? t('sourceHint') : !props.confirmed ? t('confirmHint') : null;
  const rowText = ({ name, upload, added }: CvRow) =>
    added
      ? t(`row.${added}`, { name })
      : upload.phase === 'uploading'
        ? t('row.uploading', { name, percent: upload.percent })
        : upload.phase === 'checking'
          ? t(upload.slow ? 'row.slow' : 'row.checking', { name })
          : upload.phase === 'error'
            ? t('row.error', { name, reason: tf(upload.message) })
            : t(`row.${upload.phase}`, { name });
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('title')}
      description={t('description')}
      closeLabel={t('close')}
      trigger={
        props.trigger ?? (
          <Button>
            <UploadIcon />
            {t('open')}
          </Button>
        )
      }
    >
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <RadioGroup
          legend={t('source')}
          name="source"
          required
          options={SOURCE_OPTIONS.map((value) => ({ value, label: t(`sources.${value}`) }))}
          value={props.source}
          onValueChange={props.onSourceChange}
        />
        <div className="flex flex-col gap-3">
          <FilePicker
            label={t('choose')}
            hint={t('limits')}
            accept={props.accept}
            multiple
            onSelect={props.onSelectCvs}
            disabled={props.pending}
          />
          {rows.length > 0 && (
            <>
              {/* <output> carries the status role: the count is announced, not every percent of every row. */}
              <output className="text-meta text-text-2">{t('ready', { count: props.readyCount })}</output>
              <ul
                aria-label={t('files', { count: rows.length })}
                // No scroll box of its own: the dialog scrolls, and it holds focusable controls (axe scrollable-region-focusable).
                className="flex flex-col gap-1 text-body text-text"
              >
                {rows.map((row) => (
                  <li
                    key={row.key}
                    className={`flex items-center gap-1.5 break-all ${row.upload.phase === 'error' ? 'text-err-text' : ''}`}
                  >
                    {row.upload.phase === 'error' && errorIcon}
                    {rowText(row)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {props.over > 0 && (
            <p role="alert" className="flex items-center gap-1.5 text-meta font-semibold text-err-text">
              {errorIcon}
              {t('over', { count: props.over })}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-meta font-semibold text-err-text">
            {errorIcon}
            {error}
          </p>
        )}
        <SuccessBanner>
          {result?.ok && t('added', { count: result.applications.filter((a) => a.created).length })}
        </SuccessBanner>
        <div className="flex flex-col gap-1">
          <Checkbox
            checked={props.confirmed}
            onChange={(event) => props.onConfirmedChange(event.target.checked)}
            disabled={props.pending}
            label={tc(RIGHT_TO_PROCESS_KEY, { title: props.jobTitle })}
          />
          {hint && (
            <p id={hintId} className="text-meta text-text-2">
              {hint}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button>{t('done')}</Button>
          </DialogClose>
          {props.rankingHref ? (
            <DialogClose asChild>
              <Link href={props.rankingHref as Route} className={buttonClassName('primary')}>
                {t('goToRanking')}
              </Link>
            </DialogClose>
          ) : (
            <Button
              type="submit"
              variant="primary"
              disabled={!props.canSubmit}
              aria-busy={props.pending || undefined}
              aria-describedby={hint ? hintId : undefined}
            >
              {t('submit', { count: props.readyCount })}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
