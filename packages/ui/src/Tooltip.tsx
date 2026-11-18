'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

export type TooltipProps = {
  content: ReactNode;
  /** One focusable element, e.g. a Button; it shows the tooltip on hover and on keyboard focus. */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
};

/**
 * Supplementary only: the same information must also be on screen or in the trigger's accessible name, because
 * touch users never see a tooltip. Never wrap a disabled control (it cannot take focus or hover).
 * Radix shows it on focus and hover, hides it on Escape and links it with aria-describedby (WCAG 1.4.13).
 */
// shortcut: Radix sides are physical (left/right), so side="left"/"right" does not flip in RTL; map start/end when Arabic ships
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={4}
            className="z-50 max-w-xs rounded-control bg-action px-2 py-1 text-meta text-on-action shadow-pop transition-opacity duration-120 ease-case starting:opacity-0 motion-reduce:transition-none"
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
