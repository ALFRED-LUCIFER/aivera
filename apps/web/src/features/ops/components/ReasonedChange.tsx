'use client';

import { Button, Label, PreviewConfirmCard, SuccessBanner, Textarea } from '@aivera/ui';
import { useId, type ReactNode } from 'react';

export type ReasonedChangeProps = {
  labels: {
    /** The trigger's visible word, e.g. "Approve". */
    open: string;
    /** Added after `open` in the accessible name only, so rows of "Approve" buttons stay distinct: the workspace name. */
    openSuffix?: string;
    title: string;
    body: string;
    confirm: string;
    pending: string;
    cancel: string;
    close: string;
    footer: string;
    failed: string;
    reason: string;
    hint: string;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit for a change that needs no reason: the card then has no reason field. */
  reason?: { value: string; onChange: (value: string) => void };
  canConfirm: boolean;
  onConfirm: () => Promise<void>;
  /** The success message once confirmed; null before. */
  done: ReactNode;
};

/**
 * An operator's change on the shared preview-confirm card (AIV-P2-037, AIV-P2-039): what will happen, a required reason
 * when the change needs one, and Confirm, which stays disabled until the reason is long enough.
 */
export function ReasonedChange({
  labels,
  open,
  onOpenChange,
  reason,
  canConfirm,
  onConfirm,
  done,
}: ReasonedChangeProps) {
  const reasonId = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-3">
      <PreviewConfirmCard
        title={labels.title}
        trigger={
          // The visible word starts the accessible name (WCAG 2.5.3); the suffix tells rows of "Approve" apart.
          <Button
            className="self-start"
            aria-label={labels.openSuffix ? `${labels.open} ${labels.openSuffix}` : undefined}
          >
            {labels.open}
          </Button>
        }
        open={open}
        onOpenChange={onOpenChange}
        closeLabel={labels.close}
        confirmLabel={labels.confirm}
        pendingLabel={labels.pending}
        cancelLabel={labels.cancel}
        footer={labels.footer}
        errorMessage={labels.failed}
        confirmDisabled={!canConfirm}
        onConfirm={onConfirm}
        onCancel={() => {}}
      >
        <p>{labels.body}</p>
        {reason && (
          <div className="mt-4 flex flex-col gap-1.5">
            <Label htmlFor={reasonId}>{labels.reason}</Label>
            <Textarea
              id={reasonId}
              aria-describedby={hintId}
              required
              maxLength={500}
              rows={3}
              value={reason.value}
              onChange={(e) => reason.onChange(e.target.value)}
            />
            <p id={hintId} className="text-meta text-text-2">
              {labels.hint}
            </p>
          </div>
        )}
      </PreviewConfirmCard>
      <SuccessBanner>{done}</SuccessBanner>
    </div>
  );
}
