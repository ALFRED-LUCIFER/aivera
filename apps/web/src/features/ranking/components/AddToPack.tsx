'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Input, Label, PreviewBanner, RadioGroup, Textarea } from '@credalent/ui';
import { useId } from 'react';
import { NAME_MAX, NEW_PACK, NOTE_MAX, type PackView } from '../domain/pack.ts';
import { focusOnOpen } from './ChooseForInterview.tsx';
import { ScoreCell } from './ScoreCell.tsx';

// AIV-P2-010: "Add to decision pack" from the ranking's bulk bar, in the shared inline PreviewBanner where the
// Candidates artboard (docs/01-design/artboards/Candidates.dc.html) draws its bulk preview. Deviations:
// - the artboard draws no pack dialog: the pack is chosen in the preview (an undecided pack of the job, or a new one
//   with a name), and the ticket's separate dialog step is folded into it, so one preview does both;
// - after Confirm the ranking stays and says how many were added, with a link that opens the pack, rather than
//   leaving the ranking, so "In shortlist pack" shows on the rows at once;
// - a candidate not yet scored is listed but not added: a pack holds each member's assessment (AIV-P2-009).

export function AddToPack({ view }: { view: PackView }) {
  const t = useTranslations('ranking.pack');
  const unnamed = useTranslations('ranking')('unnamed');
  const nameId = useId();
  const reasonId = useId();
  const errorId = useId();
  const { preview } = view;
  if (!preview) return null;
  return (
    <PreviewBanner
      key={view.opened}
      level={2}
      title={t('title', { count: preview.toAdd.length })}
      consequence={t('consequence')}
      confirmLabel={t('confirm', { count: preview.toAdd.length })}
      pendingLabel={t('pending')}
      confirmDisabled={!view.canConfirm}
      cancelLabel={t('cancel')}
      footer={t('footer')}
      errorMessage={t(view.error === 'notOnJob' ? 'notOnJob' : 'failed')}
      onConfirm={view.onConfirm}
      onCancel={view.onCancel}
    >
      <ul className="flex flex-col divide-y divide-border">
        {preview.people.map(({ row, status }) => (
          <li key={row.id} className="flex flex-col gap-1 py-2">
            <span className="font-semibold">{row.name ?? unnamed}</span>
            {status === 'add' ? <ScoreCell row={row} /> : <span className="text-meta text-text-2">{t(status)}</span>}
          </li>
        ))}
      </ul>
      <div ref={focusOnOpen} tabIndex={-1} className="mt-3 outline-none">
        <RadioGroup
          legend={t('legend')}
          value={view.target}
          onValueChange={view.onTargetChange}
          options={[
            ...view.packs.map((p) => ({
              value: p.id,
              label: t('existing', { name: p.name, count: p.candidateIds.length }),
            })),
            { value: NEW_PACK, label: t('new') },
          ]}
        />
      </div>
      {view.target === NEW_PACK && (
        <div className="mt-2 flex flex-col gap-1.5">
          <Label htmlFor={nameId}>{t('name')}</Label>
          <Input
            id={nameId}
            required
            maxLength={NAME_MAX}
            value={view.name}
            onChange={(event) => view.onNameChange(event.target.value)}
          />
        </div>
      )}
      <div className="mt-3 flex flex-col gap-1.5">
        <Label htmlFor={reasonId}>{t('reason')}</Label>
        <Textarea
          id={reasonId}
          required
          rows={2}
          maxLength={NOTE_MAX}
          aria-invalid={!view.reasonValid || undefined}
          aria-describedby={view.reasonValid ? undefined : errorId}
          value={view.reason}
          onChange={(event) => view.onReasonChange(event.target.value)}
        />
        {!view.reasonValid && (
          <span id={errorId} className="text-meta text-err-text">
            {t('reasonRequired')}
          </span>
        )}
      </div>
    </PreviewBanner>
  );
}
