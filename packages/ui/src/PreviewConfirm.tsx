'use client';

import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from './Button.tsx';
import { Dialog, type DialogProps } from './Dialog.tsx';

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
  /** Keeps Confirm disabled until the body is complete, e.g. a required reason (never set it while pending). */
  confirmDisabled?: boolean;
  /** Omit to hide Edit. */
  editLabel?: string;
  cancelLabel: string;
  /** "Nothing changes until you confirm." */
  footer: ReactNode;
  /** Shown when onConfirm rejects: "That did not go through. Nothing was changed." */
  errorMessage: ReactNode;
  /**
   * The only path that applies the change. Called at most once until it rejects; after it resolves the preview stays
   * pending until the caller closes or replaces it. It must settle: reject on a timeout, or the preview cannot be
   * dismissed.
   */
  onConfirm: () => unknown;
  onEdit?: () => void;
  onCancel: () => void;
};

// A reused card starts fresh on each opening: `active` turning on clears the state, rearm() clears the guard.
function usePreviewConfirm(onConfirm: () => unknown, active = true) {
  const busy = useRef(false); // a ref, not state: two clicks in one tick both see the state from before
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) {
      setPending(false);
      setFailed(false);
    }
  }
  const rearm = () => {
    busy.current = false;
  };
  const confirm = async () => {
    if (busy.current) return; // SAFETY: see "Scenario: Only Confirm applies the change, once"
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      // shortcut: callers must reject on timeout; otherwise the card stays pending and cannot be dismissed. Add a
      // timeout here if a caller cannot guarantee one.
      await onConfirm();
      // Stays pending on success, so the change cannot be sent twice; the caller closes or replaces the card.
    } catch {
      busy.current = false;
      setPending(false);
      setFailed(true);
    }
  };
  return { pending, failed, confirm, rearm };
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
        {/* Not `disabled` while pending: disabling the focused button drops focus to <body>, outside the dialog.
            The guard in usePreviewConfirm makes extra presses no-ops; the label and aria-busy show the state. */}
        <Button
          variant="primary"
          aria-busy={p.pending || undefined}
          disabled={!p.pending && p.confirmDisabled}
          onClick={p.confirm}
        >
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
  /** Without a trigger (assistant, bulk bar), return focus here: preventDefault, then focus the opener. */
  onCloseAutoFocus?: DialogProps['onCloseAutoFocus'];
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
  onCloseAutoFocus,
  closeLabel,
  onCancel,
  ...body
}: PreviewConfirmCardProps) {
  const { rearm, ...state } = usePreviewConfirm(onConfirm, open);
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
      closeDisabled={state.pending}
      trigger={trigger}
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        rearm();
        cancelRef.current?.focus();
      }}
      {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
    >
      <PreviewBody {...body} {...state} onCancel={requestClose} cancelRef={cancelRef} />
    </Dialog>
  );
}

/**
 * The inline preview (Inbox, Candidates, Candidate): a region named by its h3 title; Escape cancels. After onConfirm
 * resolves it stays pending until the caller replaces it, usually with a SuccessBanner message.
 */
export function PreviewBanner({ title, onConfirm, onCancel, ...body }: PreviewConfirmProps) {
  const state = usePreviewConfirm(onConfirm);
  const id = useId();
  const cancel = () => {
    if (!state.pending) onCancel();
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape bubbles up from the controls inside; the region itself takes no input
    <section
      aria-labelledby={id}
      className="rounded-card border border-border-strong bg-surface-raised p-4 shadow-1"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.stopPropagation(); // one Escape cancels this preview, not also a layer around it
        cancel();
      }}
    >
      <h3 id={id} className="mb-2 text-card text-text">
        {title}
      </h3>
      <PreviewBody {...body} {...state} onCancel={cancel} />
    </section>
  );
}

export type SuccessBannerProps = { children?: ReactNode };

/**
 * After a confirmed change: "2 evidence requests sent. …". Mount it empty with the page and pass the message after
 * the confirm: a status region that mounts with its text already in it is often not announced.
 */
export function SuccessBanner({ children }: SuccessBannerProps) {
  return (
    <output
      className={
        children
          ? 'flex items-start gap-2 rounded-card border border-ok-border bg-ok-bg p-4 text-body text-ok-text'
          : undefined
      }
    >
      {children && (
        <>
          <CheckIcon />
          <span>{children}</span>
        </>
      )}
    </output>
  );
}

function CheckIcon() {
  return (
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
