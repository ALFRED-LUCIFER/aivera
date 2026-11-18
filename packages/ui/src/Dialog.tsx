'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from './Button.tsx';
import { CloseIcon } from './CloseIcon.tsx';
import { cx } from './cx.ts';

type ContentProps = ComponentProps<typeof DialogPrimitive.Content>;

export type DialogProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Accessible name of the close button, from i18n. */
  closeLabel: string;
  /** Disables the close button, e.g. while a confirmed change is being applied. */
  closeDisabled?: boolean;
  /** The element that opens the dialog, usually a Button. */
  trigger?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Move initial focus (preventDefault, then focus an element); never onto a destructive button. */
  onOpenAutoFocus?: ContentProps['onOpenAutoFocus'];
  /** Return focus where it belongs when there is no trigger (preventDefault, then focus an element). */
  onCloseAutoFocus?: ContentProps['onCloseAutoFocus'];
  onEscapeKeyDown?: ContentProps['onEscapeKeyDown'];
  /** For layout (e.g. a wider max-w), not for padding or colour. */
  className?: string;
  children?: ReactNode;
};

/** Wrap a footer Button in DialogClose to close the dialog without controlling `open`. */
export const DialogClose = DialogPrimitive.Close;

// Radix traps focus, restores it to the trigger, closes on Escape and labels the dialog by its title.
// A pass-through frame inset 16 px from the viewport centres the panel; max-h-full caps it to the frame, so tall
// content scrolls inside the panel at 390 px and at 200% zoom.
export function Dialog({
  title,
  description,
  closeLabel,
  closeDisabled,
  trigger,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  className,
  children,
  ...root
}: DialogProps) {
  return (
    <DialogPrimitive.Root {...root}>
      {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-bg/80 transition-opacity duration-120 ease-case starting:opacity-0 motion-reduce:transition-none" />
        <div className="pointer-events-none fixed inset-4 z-50 flex items-center justify-center">
          <DialogPrimitive.Content
            className={cx(
              'pointer-events-auto relative max-h-full w-full max-w-lg overflow-y-auto rounded-card border border-border bg-surface-raised p-6 shadow-pop',
              'transition-opacity duration-120 ease-case starting:opacity-0 motion-reduce:transition-none',
              className,
            )}
            {...(description ? {} : { 'aria-describedby': undefined })}
            {...(onOpenAutoFocus ? { onOpenAutoFocus } : {})}
            {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
            {...(onEscapeKeyDown ? { onEscapeKeyDown } : {})}
          >
            <DialogPrimitive.Title className="pe-10 font-display text-section text-text">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="mt-2 text-body text-text-2">
                {description}
              </DialogPrimitive.Description>
            )}
            {children && <div className="mt-4">{children}</div>}
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="iconOnly"
                aria-label={closeLabel}
                disabled={closeDisabled}
                className="absolute end-2 top-2"
              >
                <CloseIcon />
              </Button>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
