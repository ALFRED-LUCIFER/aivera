'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Dialog, DialogClose, FilePicker, RadioGroup, SuccessBanner } from '@credalent/ui';
import { SOURCE_OPTIONS, type AddApplicantsResult } from '../domain/addApplicants.ts';
import type { DirectUpload } from '@/features/files';

// AIV-P1-019: "Add applicants" (job, source, one or more CVs). No artboard draws this dialog: the Inbox and Candidates
// artboards only name the upload page. Built from the shared Dialog, RadioGroup and FilePicker (whose control is the
// CApply artboard's "Upload CV"). Deviations, since there is nothing to port:
// - CVs are added one at a time with the FilePicker's single-file button, each listed once the files module has it clean;
// - the result is listed in the dialog ("Unnamed applicant · CV received"), not as rows on the page: the Candidates tab
//   has no applicant list until the ranked table (AIV-P1-034) and the Inbox (AIV-P1-021) read intake.

export type AddApplicantsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: string;
  onSourceChange: (source: string) => void;
  upload: DirectUpload;
  accept: string;
  onSelectCv: (file: File) => void;
  cvs: { fileId: string; name: string }[];
  canSubmit: boolean;
  pending: boolean;
  result: AddApplicantsResult | null;
  onSubmit: () => void;
};

export function AddApplicantsDialog(props: AddApplicantsDialogProps) {
  const t = useTranslations('addApplicants');
  const tf = useTranslations('files');
  const { upload, result, cvs } = props;
  const status =
    upload.phase === 'uploading'
      ? tf('uploading', { percent: upload.percent })
      : upload.phase === 'checking'
        ? t('checking')
        : null;
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('title')}
      description={t('description')}
      closeLabel={t('close')}
      trigger={<Button>{t('open')}</Button>}
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
        {result && !result.ok && (
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
            {result.error === 'jobNotFound' ? t('jobNotFound') : tf(result.error)}
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
        <div className="flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button>{t('done')}</Button>
          </DialogClose>
          <Button type="submit" variant="primary" disabled={!props.canSubmit} aria-busy={props.pending || undefined}>
            {t('submit', { count: cvs.length })}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
