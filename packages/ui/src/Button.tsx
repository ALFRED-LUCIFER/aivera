import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'compact' | 'standard' | 'touch';

// DESIGN.md: 36 compact, 40 standard, 44 touch and on any coarse pointer. One primary per view.
const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border font-semibold ' +
  'pointer-coarse:min-h-11 cursor-pointer transition-colors duration-120 ease-case motion-reduce:transition-none ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-subtle disabled:text-text-3';

const variants: Record<ButtonVariant, string> = {
  primary: 'border-action bg-action text-on-action hover:border-action-hover hover:bg-action-hover',
  secondary: 'border-border-strong bg-surface text-text hover:bg-surface-subtle',
  ghost: 'border-transparent bg-transparent text-text-2 hover:bg-surface-subtle hover:text-text',
};

const sizes: Record<ButtonSize, string> = {
  compact: 'h-9 px-3 text-meta',
  standard: 'h-10 px-3.5 text-body',
  touch: 'h-11 px-4 text-body',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/** A disabled button keeps a visible reason as its label, e.g. "Unavailable", never opacity alone. */
export function Button({
  variant = 'secondary',
  size = 'standard',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-disabled={props.disabled || undefined}
      className={cx(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
}
