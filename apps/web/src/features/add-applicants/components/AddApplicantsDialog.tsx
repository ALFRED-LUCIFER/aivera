'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Checkbox, Dialog, DialogClose, FilePicker, RadioGroup, SuccessBanner } from '@credalent/ui';
import { useId, type ReactNode } from 'react';
import { RIGHT_TO_PROCESS_KEY, SOURCE_OPTIONS, type AddApplicantsResult } from '../domain/addApplicants.ts';
import type { DirectUpload } from '@/features/files';

// AIV-P1-019: "Add applicants" (job, source, one or more CVs). No artboard draws this dialog: the Inbox and Candidates
// artboards only name the upload page. Built from the shared Dialog, RadioGroup and FilePicker (whose control is the
// CApply artboard's "Upload CV"). Deviations, since there is nothing to port:
// - CVs are added one at a time with the FilePicker's single-file button, each listed once the files module has it clean;
// - the result is listed in the dialog ("Unnamed applicant · CV received"); the Candidates tab's applicant list
//   (AIV-P1-086) shows the new rows behind it.
// AIV-P1-104: the confirmation checkbox above the add button, from the Import artboard's "Check before adding" footer. Not
// built from that artboard (AIV-P1-102 builds the check): its Consent column ("Consent recorded", "Consent not yet
// given"), the summary clause "1 has not given consent yet" and the footnote "People without consent are added but not
// assessed until they agree" are dropped, because nobody is held back one by one. The button says "Add N people to this
// job" as the artboard does.

export type AddApplicantsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: string;
  onSourceChange: (source: string) => void;
  upload: DirectUpload;
  accept: string;
  onSelectCv: (file: File) => void;
  cvs: { fileId: string; name: string }[];
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
  /** The button that opens the dialog; "Add applicants" by default. Bring in candidates' card says "Upload files". */
  trigger?: ReactNode;
};

export function AddApplicantsDialog(props: AddApplicantsDialogProps) {
  const t = useTranslations('addApplicants');
  const tf = useTranslations('files');
  const ta = useTranslations('access');
  const tc = useTranslations();
  const hintId = useId();
  const { upload, result, cvs } = props;
  const status =
    upload.phase === 'uploading'
      ? tf('uploading', { percent: upload.percent })
      : upload.phase === 'checking'
        ? upload.slow
          ? tf('stillChecking')
          : t('checking')
        : null;
  const error = props.failure
    ? ta(props.failure)
    : result && !result.ok
      ? result.error === 'jobNotFound' || result.error === 'confirmationRequired'
        ? t(result.error)
        : tf(result.error)
      : null;
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('title')}
      description={t('description')}
      closeLabel={t('close')}
      trigger={props.trigger ?? <Button>{t('open')}</Button>}
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
          options={SOURCE_OPTIONS.map((value) => ({ value, label: t(`sources.${value}`) }))}
          value={props.source}
          onValueChange={props.onSourceChange}
        />
        <div className="flex flex-col gap-3">
          <FilePicker
            label={tf('uploadCv')}
            hint={tf('limits.cv')}
            accept={props.accept}
            onSelect={props.onSelectCv}
            disabled={upload.phase === 'uploading' || upload.phase === 'checking' || props.pending}
            progress={upload.phase === 'uploading' ? upload.percent : null}
            status={status}
            error={upload.phase === 'error' ? tf(upload.message) : null}
          />
          {cvs.length > 0 && (
            <ul aria-label={t('ready', { count: cvs.length })} className="flex flex-col gap-1 text-body text-text">
              {cvs.map((cv) => (
                <li key={cv.fileId} className="break-all">
                  {t('readyCv', { name: cv.name })}
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-meta font-semibold text-err-text">
            {/* The FilePicker's error icon: status colour always travels with an icon and words (DESIGN.md). */}
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
            {error}
          </p>
        )}
        <SuccessBanner>
          {result?.ok && (
            <>
              {t('added', { count: result.applications.filter((a) => a.created).length })}
              <ul className="mt-1">
                {result.applications.map((a, i) => (
                  <li key={`${a.applicationId}-${i}`}>{a.created ? t('received') : t('sourceAdded')}</li>
                ))}
              </ul>
            </>
          )}
        </SuccessBanner>
        <div className="flex flex-col gap-1">
          <Checkbox
            checked={props.confirmed}
            onChange={(event) => props.onConfirmedChange(event.target.checked)}
            disabled={props.pending}
            label={tc(RIGHT_TO_PROCESS_KEY, { title: props.jobTitle })}
          />
          {!props.confirmed && (
            <p id={hintId} className="text-meta text-text-2">
              {t('confirmHint')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button>{t('done')}</Button>
          </DialogClose>
          <Button
            type="submit"
            variant="primary"
            disabled={!props.canSubmit}
            aria-busy={props.pending || undefined}
            aria-describedby={props.confirmed ? undefined : hintId}
          >
            {t('submit', { count: cvs.length })}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
