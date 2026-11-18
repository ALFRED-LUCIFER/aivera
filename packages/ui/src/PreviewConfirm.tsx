'use client';

import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from './Button.tsx';
import { Dialog } from './Dialog.tsx';

// AGENTS.md 1.5: every proposed change is shown first and applied only by Confirm. The card never performs the
// action; it emits onConfirm, onEdit and onCancel. All labels come from i18n through props.
export type PreviewConfirmProps = {
  /** "Preview: move Sara Al Qahtani to Round 2". */
  title: ReactNode;
  /** The body: current versus proposed state, or "Not sent yet" plus options such as a follow-up checkbox. */
  children?: ReactNode;
  /** What happens once confirmed, e.g. "Sara gets an interview invitation." */
  consequence?: ReactNode;
  /** "Confirm move", "Send 3 requests". */
  confirmLabel: string;
  /** Shown on the Confirm button while onConfirm runs, e.g. "Moving…". */
  pendingLabel: string;
  /** Omit to hide Edit. */
  editLabel?: string;
  cancelLabel: string;
  /** "Nothing changes until you confirm." */
  footer: ReactNode;
  /** Shown when onConfirm rejects: "That did not go through. Nothing was changed." */
  errorMessage: ReactNode;
  /** The only path that applies the change. Called at most once until it rejects. */
  onConfirm: () => unknown;
  onEdit?: () => void;
  onCancel: () => void;
};

function usePreviewConfirm(onConfirm: () => unknown) {
  const busy = useRef(false); // a ref, not state: two clicks in one tick both see the state from before
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirm = async () => {
    // SAFETY: mutation check: removed this guard -> "Scenario: Only Confirm applies the change, once" failed
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      await onConfirm();
      // Stays pending on success, so the change cannot be sent twice; the caller closes or replaces the card.
    } catch {
      busy.current = false;
      setPending(false);
      setFailed(true);
    }
  };
  return { pending, failed, confirm };
}

type BodyProps = Omit<PreviewConfirmProps, 'title' | 'onConfirm'> & {
  pending: boolean;
  failed: boolean;
  confirm: () => void;
  cancelRef?: RefObject<HTMLButtonElement | null>;
};

function PreviewBody({ cancelRef, ...p }: BodyProps) {
  return (
    <>
      {p.children && <div className="text-body text-text">{p.children}</div>}
      {p.consequence && <p className="mt-3 text-body text-text-2">{p.consequence}</p>}
      {p.failed && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-control border border-err-border bg-err-bg p-3 text-body text-err-text"
        >
          <AlertIcon />
          {p.errorMessage}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" disabled={p.pending} aria-busy={p.pending || undefined} onClick={p.confirm}>
          {p.pending ? p.pendingLabel : p.confirmLabel}
        </Button>
        {p.editLabel && p.onEdit && (
          <Button disabled={p.pending} onClick={p.onEdit}>
            {p.editLabel}
          </Button>
        )}
        <Button ref={cancelRef} variant="ghost" disabled={p.pending} onClick={p.onCancel}>
          {p.cancelLabel}
        </Button>
      </div>
      <p className="mt-3 text-meta text-text-2">{p.footer}</p>
    </>
  );
}

export type PreviewConfirmCardProps = PreviewConfirmProps & {
  open: boolean;
  /** Opens from the trigger; closing (Cancel, Escape, close button, outside click) also calls onCancel. */
  onOpenChange: (open: boolean) => void;
  /** The opener; focus returns to it on close. */
  trigger?: ReactNode;
  /** Accessible name of the dialog's close button. */
  closeLabel: string;
};

/**
 * The preview in a Dialog, for assistant and bulk actions. Controlled, so it can refuse to close while onConfirm
 * runs; close it yourself (open=false) once onConfirm resolves. Initial focus lands on Cancel, never on Confirm.
 */
export function PreviewConfirmCard({
  title,
  onConfirm,
  open,
  onOpenChange,
  trigger,
  closeLabel,
  onCancel,
  ...body
}: PreviewConfirmCardProps) {
  const state = usePreviewConfirm(onConfirm);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const requestClose = () => {
    if (state.pending) return; // the change may still land; cancelling now would be a false promise
    onCancel();
    onOpenChange(false);
  };
  return (
    <Dialog
      title={title}
      closeLabel={closeLabel}
      trigger={trigger}
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        cancelRef.current?.focus();
      }}
    >
      <PreviewBody {...body} {...state} onCancel={requestClose} cancelRef={cancelRef} />
    </Dialog>
  );
}

export type PreviewBannerProps = PreviewConfirmProps & {
  /** Heading level of the title. */
  level?: 2 | 3 | 4;
};

/** The inline preview (Inbox, Candidates, Candidate): a region named by its title; Escape cancels. */
export function PreviewBanner({ title, onConfirm, onCancel, level = 3, ...body }: PreviewBannerProps) {
  const state = usePreviewConfirm(onConfirm);
  const id = useId();
  const Heading = `h${level}` as const;
  const cancel = () => {
    if (!state.pending) onCancel();
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape bubbles up from the controls inside; the region itself takes no input
    <section
      aria-labelledby={id}
      className="rounded-card border border-border-strong bg-surface-raised p-4 shadow-1"
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel();
      }}
    >
      <Heading id={id} className="mb-2 text-card text-text">
        {title}
      </Heading>
      <PreviewBody {...body} {...state} onCancel={cancel} />
    </section>
  );
}

export type SuccessBannerProps = { children: ReactNode };

/** After a confirmed change: "2 evidence requests sent. …". Announced politely; ok colour with an icon and words. */
export function SuccessBanner({ children }: SuccessBannerProps) {
  return (
    <output className="flex items-start gap-2 rounded-card border border-ok-border bg-ok-bg p-4 text-body text-ok-text">
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="mt-0.5 size-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="m3.5 8.5 3 3 6-7" />
      </svg>
      <span>{children}</span>
    </output>
  );
}

function AlertIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="mt-0.5 size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75v4M8 11v.25" />
    </svg>
  );
}
