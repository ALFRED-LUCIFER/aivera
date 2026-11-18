'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { Button } from './Button.tsx';
import { CloseIcon } from './CloseIcon.tsx';

export type DialogProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Accessible name of the close button, from i18n. */
  closeLabel: string;
  /** The element that opens the dialog, usually a Button. */
  trigger?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
};

/** Wrap a footer Button in DialogClose to close the dialog without controlling `open`. */
export const DialogClose = DialogPrimitive.Close;

// Radix traps focus, restores it to the trigger, closes on Escape and labels the dialog by its title.
export function Dialog({ title, description, closeLabel, trigger, children, ...root }: DialogProps) {
  return (
    <DialogPrimitive.Root {...root}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-bg/80 transition-opacity duration-120 ease-case starting:opacity-0 motion-reduce:transition-none" />
        <DialogPrimitive.Content
          className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-lg -translate-y-1/2 rounded-card border border-border bg-surface-raised p-6 shadow-pop transition-opacity duration-120 ease-case starting:opacity-0 motion-reduce:transition-none"
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <DialogPrimitive.Title className="pe-10 font-display text-section text-text">{title}</DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="mt-2 text-body text-text-2">
              {description}
            </DialogPrimitive.Description>
          )}
          {children && <div className="mt-4">{children}</div>}
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="compact" aria-label={closeLabel} className="absolute end-3 top-3 w-9 px-0">
              <CloseIcon />
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
