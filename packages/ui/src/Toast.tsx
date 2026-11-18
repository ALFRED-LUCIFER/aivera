'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import type { ReactNode } from 'react';
import { Button } from './Button.tsx';
import { CloseIcon } from './CloseIcon.tsx';

export type ToastProviderProps = {
  /** Announced with each toast, e.g. "Notification", from i18n. */
  toastLabel: string;
  /** Name of the toast region, e.g. "Notifications (F8)", from i18n. */
  regionLabel: string;
  children: ReactNode;
};

/** Mount once near the root; toasts render into its viewport at the end-bottom corner. */
export function ToastProvider({ toastLabel, regionLabel, children }: ToastProviderProps) {
  return (
    <ToastPrimitive.Provider label={toastLabel}>
      {children}
      <ToastPrimitive.Viewport
        label={regionLabel}
        className="fixed end-0 bottom-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4"
      />
    </ToastPrimitive.Provider>
  );
}

export type ToastProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Accessible name of the close button, from i18n. */
  closeLabel: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Milliseconds before it closes itself; Radix pauses the timer on hover and focus. */
  duration?: number;
};

// shortcut: no action slot, status variant or RTL swipe direction yet; add with the first screen that needs them
export function Toast({ title, description, closeLabel, ...root }: ToastProps) {
  return (
    <ToastPrimitive.Root
      className="relative rounded-card border border-border bg-surface-raised p-4 pe-12 shadow-pop transition-opacity duration-120 ease-case starting:opacity-0 motion-reduce:transition-none"
      {...root}
    >
      <ToastPrimitive.Title className="text-body font-semibold text-text">{title}</ToastPrimitive.Title>
      {description && (
        <ToastPrimitive.Description className="mt-1 text-meta text-text-2">{description}</ToastPrimitive.Description>
      )}
      <ToastPrimitive.Close asChild>
        <Button variant="ghost" size="iconOnly" aria-label={closeLabel} className="absolute end-2 top-2">
          <CloseIcon />
        </Button>
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}
