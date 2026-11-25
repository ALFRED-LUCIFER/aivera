'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Label, PreviewBanner, Textarea } from '@credalent/ui';
import { useId } from 'react';
import { CHOICE_REASON_MAX, type ChooseView } from '../domain/choose.ts';
import { ScoreCell } from './ScoreCell.tsx';

// AIV-P1-114: "Choose for interview" from the ranking's bulk bar. The shared inline PreviewBanner, where the Candidates
// artboard (docs/01-design/artboards/Candidates.dc.html) draws its bulk preview, above the bar. Deviations:
// - the artboard's bar draws Compare, Request evidence, Message and Add to decision pack, not "Choose for interview"
//   (the owner's decision on the ticket); the other actions join with their tickets (domain/selection.ts);
// - its preview is an evidence request; this one lists each person with their backed score and claim range, what
//   Round 1 should investigate (the evidence gaps, AIV-P1-113), the round, the interviewer and a required reason;
// - no "Not sent yet" chip: nothing is sent to anyone, so the consequence line says "Nobody is contacted" instead;
// - its title is an h2 (PreviewBanner `level`), as the artboard draws it, so the page's heading order holds.

// Stable, so focus moves into the preview once, when it opens.
const focusOnMount = (element: HTMLElement | null) => element?.focus();

export function ChooseForInterview({ view }: { view: ChooseView }) {
  const t = useTranslations('ranking.choose');
  const reasonId = useId();
  const errorId = useId();
  const { preview } = view;
  if (!preview) return null;
  return (
    <PreviewBanner
      level={2}
      title={t('title', { count: preview.toChoose })}
      consequence={t('consequence')}
      confirmLabel={t('confirm', { count: preview.toChoose })}
      pendingLabel={t('pending')}
      confirmDisabled={preview.toChoose === 0 || !view.reasonValid}
      cancelLabel={t('cancel')}
      footer={t('footer')}
      errorMessage={t(view.error === 'notOnJob' ? 'notOnJob' : 'failed')}
      onConfirm={view.onConfirm}
      onCancel={view.onCancel}
    >
      <ul className="flex flex-col divide-y divide-border">
        {preview.people.map((row) => (
          <li key={row.id} className="flex flex-col gap-1 py-2">
            <span className="font-semibold">{row.name ?? t('unnamed')}</span>
            {row.stage === 'interview' ? (
              <span className="text-meta text-text-2">{t('alreadyChosen')}</span>
            ) : (
              <>
                {/* Not assessed yet: the score cell says "Not yet scored" and "Not yet available"; no gaps are claimed. */}
                <ScoreCell row={row} />
                {row.score && (
                  <span className="text-meta text-text-2">
                    {row.score.investigate.length > 0
                      ? t('investigate', { names: row.score.investigate.join('; ') })
                      : t('noGaps')}
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3">{t('round')}</p>
      <p>{t('interviewer')}</p>
      <div className="mt-3 flex flex-col gap-1.5">
        <Label htmlFor={reasonId}>{t('reason')}</Label>
        <Textarea
          ref={focusOnMount}
          id={reasonId}
          required
          rows={2}
          maxLength={CHOICE_REASON_MAX}
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
