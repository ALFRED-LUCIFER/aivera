'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useId, type FormEvent, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import { CloseIcon } from './CloseIcon.tsx';
import { Input, Label } from './Field.tsx';

export type AssistantDrawerProps = {
  /** "Aivera assistant". */
  title: ReactNode;
  /** "Context: Senior AI Engineer, 64 candidates". */
  context: ReactNode;
  /** "Ask about what is on this page". */
  inputLabel: string;
  /** "Ask". */
  askLabel: string;
  /** "Answers cite the evidence they use. Any change is shown as a preview and waits for your confirmation." */
  footer: ReactNode;
  closeLabel: string;
  /** Called with the trimmed question; empty questions are ignored. */
  onAsk: (question: string) => void;
  /** The opener ("Ask Aivera"); focus returns to it on close. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Suggested questions, answers and previews go here. */
  children?: ReactNode;
};

// Non-modal on purpose: the assistant talks about the page beside it, so the recruiter must keep reading, scrolling
// and selecting that page while it is open. A modal would hide the page from assistive tech and trap focus away
// from it. Radix still closes it on Escape, returns focus to the trigger and names it by its title.
export function AssistantDrawer({
  title,
  context,
  inputLabel,
  askLabel,
  footer,
  closeLabel,
  onAsk,
  trigger,
  children,
  ...root
}: AssistantDrawerProps) {
  const inputId = useId();
  const ask = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const question = String(new FormData(e.currentTarget).get('question') ?? '').trim();
    if (!question) return;
    onAsk(question);
    e.currentTarget.reset();
  };
  return (
    <DialogPrimitive.Root modal={false} {...root}>
      {trigger && (
        <DialogPrimitive.Trigger
          asChild
          // Re-entry: pressing the opener while the drawer is open takes you back into it instead of closing it.
          onClick={(e) => {
            if (e.currentTarget.dataset['state'] !== 'open') return;
            e.preventDefault();
            document.getElementById(inputId)?.focus();
          }}
        >
          {trigger}
        </DialogPrimitive.Trigger>
      )}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          // Working on the page must not dismiss the drawer; only Escape and the close button do.
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed inset-y-0 end-0 z-40 flex w-full max-w-sm flex-col border-s border-border bg-surface-raised shadow-pop transition-opacity duration-120 ease-case starting:opacity-0 motion-reduce:transition-none"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border p-4">
            <DialogPrimitive.Title className="font-display text-section text-text">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="iconOnly" aria-label={closeLabel}>
                <CloseIcon />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <DialogPrimitive.Description className="text-meta text-text-2">{context}</DialogPrimitive.Description>
            {children && <div className="mt-4">{children}</div>}
          </div>
          <form className="border-t border-border p-4" onSubmit={ask}>
            <Label htmlFor={inputId}>{inputLabel}</Label>
            <div className="mt-1 flex gap-2">
              <Input id={inputId} name="question" autoComplete="off" />
              <Button type="submit">{askLabel}</Button>
            </div>
            <p className="mt-3 text-meta text-text-2">{footer}</p>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
