'use client';

import { useTranslations } from '@credalent/i18n/react';
import { RETURN_NOTE_MAX } from '@credalent/jobs';
import { Button, Card, Label, PreviewConfirmCard, SuccessBanner, Textarea } from '@credalent/ui';
import { useId } from 'react';
import { APPROVAL_REASON_MAX, type ReviewView, type RubricDecisionView } from '../domain/rubric.ts';

type Props = {
  review: ReviewView | null;
  decision: RubricDecisionView;
  /** The approval email pointed to an older copy than the one awaiting approval now. */
  outdatedLink: boolean;
  /** Only the job's hiring owner returns a version sent to them; a draft has no one to return it to. */
  canReturn: boolean;
  /** A draft of a job with a hiring owner: "Send to the hiring owner" is offered beside "Approve rubric". */
  canSend: boolean;
  /** A version the viewer sent: it is with the hiring owner, and they may still approve it themselves. */
  withOwner: boolean;
};

/**
 * The approval panel on the rubric page (AIV-P1-014, ADR-014): what changed, "Approve rubric" and, for a version sent
 * for approval, "Return with a note". "Approve rubric" opens the shared preview-confirm card with the version, its
 * competencies and a required reason; only its Confirm approves, and the reason goes to the audit log (AIV-P1-165).
 * No artboard draws it; it follows the Rubric artboard's publish panel and the ERubric and ENewer emails' words.
 */
export function RubricDecision({ review, decision, outdatedLink, canReturn, canSend, withOwner }: Props) {
  const title = withOwner ? 'titleSent' : canReturn ? 'title' : 'titleDraft';
  const intro = withOwner ? 'introSent' : canReturn ? 'intro' : 'introDraft';
  const t = useTranslations('rubric.decide');
  const tr = useTranslations('rubric');
  const ta = useTranslations('access');
  const noteId = useId();
  const reasonId = useId();
  const { status } = decision;
  const done = status === 'approved' || status === 'returned' ? status : null;
  const problem =
    status === 'stale' || status === 'failed'
      ? t(status)
      : status === 'saveFailed' || status === 'saveForbidden'
        ? ta(status)
        : null;

  return (
    <Card title={review ? t(title, { version: review.version }) : t('doneTitle')} level={2}>
      <div className="flex flex-col gap-3">
        {/* Mounted empty with the panel, so the message after a decision is announced (SuccessBanner). */}
        <SuccessBanner>
          {done &&
            decision.decided !== null &&
            t(done, { version: decision.decided.version, inForce: decision.decided.inForce ? 'yes' : 'no' })}
          {status === 'sent' && t('sent')}
        </SuccessBanner>
        {review && (
          <>
            {outdatedLink && (
              <div className="rounded-control border border-border bg-surface-subtle px-3 py-2">
                <p className="font-semibold">{t('newer')}</p>
                <p className="text-meta text-text-2">{t('newerBody', { version: review.version })}</p>
              </div>
            )}
            <p className="text-text-2">{t(intro)}</p>
            {review.changeNote && (
              <div className="flex flex-col gap-1">
                <h3 className="text-card">
                  {review.approvedVersion === null
                    ? t('changedNone')
                    : t('changed', { version: review.approvedVersion })}
                </h3>
                <p className="text-meta text-text-2">{review.changeNote}</p>
              </div>
            )}
            {decision.returning ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor={noteId} className="text-card">
                  {t('noteLabel')}
                </Label>
                <Textarea
                  id={noteId}
                  value={decision.note}
                  maxLength={RETURN_NOTE_MAX}
                  onChange={(e) => decision.onNote(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabled={decision.pending || !decision.note.trim()}
                    onClick={decision.onReturn}
                  >
                    {t('confirmReturn', { version: review.version })}
                  </Button>
                  <Button variant="ghost" disabled={decision.pending} onClick={decision.onCancelReturn}>
                    {t('cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <PreviewConfirmCard
                  title={t('previewTitle', { version: review.version })}
                  trigger={
                    <Button variant="primary" disabled={decision.pending}>
                      {t('approve')}
                    </Button>
                  }
                  open={decision.approving}
                  onOpenChange={decision.onApprovingChange}
                  closeLabel={t('close')}
                  consequence={t('previewConsequence')}
                  confirmLabel={t('confirmApprove')}
                  pendingLabel={t('approving')}
                  cancelLabel={t('cancel')}
                  footer={t('previewFooter')}
                  errorMessage={t('failed')}
                  confirmDisabled={!decision.reason.trim()}
                  onConfirm={decision.onApprove}
                  onCancel={() => {}}
                >
                  <div className="flex flex-col gap-4">
                    <ul className="flex flex-col gap-2">
                      {review.competencies.map((c) => (
                        <li key={c.name} className="flex flex-col">
                          <span className="font-semibold">{c.name}</span>
                          <span className="text-meta text-text-2">
                            {[
                              tr('weight', { weight: c.weightPercent }),
                              tr('levelOf', { level: c.levelNeeded }),
                              tr(`type.${c.type}`),
                            ].join(tr('separator'))}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={reasonId}>{t('reason')}</Label>
                      <Textarea
                        id={reasonId}
                        required
                        rows={3}
                        maxLength={APPROVAL_REASON_MAX}
                        value={decision.reason}
                        onChange={(e) => decision.onReason(e.target.value)}
                      />
                    </div>
                  </div>
                </PreviewConfirmCard>
                {canReturn && (
                  <Button disabled={decision.pending} onClick={decision.onStartReturn}>
                    {t('return')}
                  </Button>
                )}
                {canSend && (
                  <Button disabled={decision.pending} onClick={decision.onSend}>
                    {t('send')}
                  </Button>
                )}
              </div>
            )}
            <p className="text-meta text-text-2">{t('footer')}</p>
          </>
        )}
        {problem && (
          <p role="alert" className="rounded-control border border-err-border bg-err-bg p-3 text-err-text">
            {problem}
          </p>
        )}
      </div>
    </Card>
  );
}
