'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Chip, Label, PreviewConfirmCard, Textarea } from '@credalent/ui';
import { MERGE_REASON_MAX } from '@credalent/candidates';
import { useId } from 'react';
import type { DuplicatesView, MergeSide, RowDuplicates } from '../domain/duplicates.ts';

// AIV-P1-018: duplicate applicants on the ranked table's candidate cell, from the Inbox artboard's flag chip
// (docs/01-design/artboards/Inbox.dc.html) and the shared preview-confirm card. Deviations:
// - the Inbox is AIV-P1-021 (#85), not built yet, so "2 duplicates merged" and "Possible duplicate of …. Merge?" sit
//   under the name on the job's ranking row instead of in an Inbox "Flags" column;
// - the artboard draws no merge preview, prompt or undo: they use the shared PreviewConfirmCard (AGENTS.md 1.5) with a
//   required reason, as the job header's "Change hiring owner" does;
// - "Undo merge" undoes the row's newest merge still inside the workspace's undo window, admins only; listing every
//   merge with its own undo waits for the candidate profile (AIV-P1-043);
// - the preview names each application's job and its sources as chips, and counts evidence sources; it does not list
//   each evidence item (the evidence profile is AIV-P1-043).

/** The row's duplicate flags and actions; renders nothing for a row without duplicates or a viewer who cannot merge. */
export function DuplicateActions({
  rowId,
  duplicates,
  view,
}: {
  rowId: string;
  duplicates: RowDuplicates;
  view: DuplicatesView;
}) {
  const t = useTranslations('ranking.duplicates');
  const reasonId = useId();
  const { possible, undo } = duplicates;
  const reasonField = (
    <div className="mt-4 flex flex-col gap-1.5">
      <Label htmlFor={reasonId}>{t('reason')}</Label>
      <Textarea
        id={reasonId}
        required
        maxLength={MERGE_REASON_MAX}
        rows={3}
        value={view.reason}
        onChange={(event) => view.onReasonChange(event.target.value)}
      />
    </div>
  );
  const card = {
    cancelLabel: t('cancel'),
    closeLabel: t('close'),
    footer: t('footer'),
    errorMessage: t('failed'),
    onCancel: () => {},
  };

  return (
    <span className="mt-1.5 flex flex-col items-start gap-1.5">
      {duplicates.mergedCount > 0 && (
        <span className="flex flex-wrap items-center gap-2">
          <Chip icon={<MergedIcon />}>{t('merged', { count: duplicates.mergedCount })}</Chip>
          {undo && (
            <PreviewConfirmCard
              {...card}
              title={t('undoTitle', { name: undo.name })}
              trigger={
                <Button size="compact" variant="ghost">
                  {t('undo')}
                </Button>
              }
              open={view.isOpen(rowId, 'undo')}
              onOpenChange={(open) => view.onOpenChange(rowId, 'undo', open)}
              confirmLabel={t('undoConfirm')}
              pendingLabel={t('undoPending')}
              confirmDisabled={!view.canConfirm(duplicates, 'undo')}
              onConfirm={() => view.onConfirm(duplicates, 'undo')}
            >
              <p>{t('undoBody', { name: undo.name })}</p>
              {reasonField}
            </PreviewConfirmCard>
          )}
        </span>
      )}
      {possible && (
        <span className="flex flex-wrap items-center gap-2 text-meta text-text-2">
          {t('possible', { name: possible.name })}
          <PreviewConfirmCard
            {...card}
            title={t('mergeTitle', { merged: possible.merged.name, survivor: possible.survivor.name })}
            trigger={<Button size="compact">{t('merge')}</Button>}
            open={view.isOpen(rowId, 'merge')}
            onOpenChange={(open) => view.onOpenChange(rowId, 'merge', open)}
            confirmLabel={t('confirm')}
            pendingLabel={t('pending')}
            confirmDisabled={!view.canConfirm(duplicates, 'merge')}
            onConfirm={() => view.onConfirm(duplicates, 'merge')}
          >
            <p>{t(`why.${possible.reason}`)}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Side heading={t('stays', { name: possible.survivor.name })} side={possible.survivor} />
              <Side heading={t('mergedIn', { name: possible.merged.name })} side={possible.merged} />
            </div>
            <p className="mt-4 font-semibold">{t('nothingDeleted', { name: possible.survivor.name })}</p>
            {reasonField}
          </PreviewConfirmCard>
        </span>
      )}
    </span>
  );
}

function Side({ heading, side }: { heading: string; side: MergeSide }) {
  const t = useTranslations('ranking.duplicates');
  return (
    <section className="flex flex-col gap-2 rounded-card border border-border p-3">
      <h4 className="text-body font-semibold text-text">{heading}</h4>
      {side.applications.length === 0 ? (
        <p className="text-meta text-text-2">{t('noApplications')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {side.applications.map((application, i) => (
            <li key={i} className="flex flex-col gap-1">
              <span>{application.job || t('noJob')}</span>
              <span className="flex flex-wrap gap-1">
                {application.sources.map((source) => (
                  <Chip key={source}>{t(`sources.${source}`)}</Chip>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-meta text-text-2">{t('evidence', { count: side.evidenceSources })}</p>
    </section>
  );
}

// The Inbox artboard's "duplicates merged" glyph: decorative, the word carries the meaning.
function MergedIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m2 12.5 4.5 4.5L15 8M11.5 16l1 1L22 8" />
    </svg>
  );
}
