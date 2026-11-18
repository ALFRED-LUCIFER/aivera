import type { ComponentProps } from 'react';
import { cx } from './cx.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'compact' | 'standard' | 'touch' | 'iconOnly';

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
  // Square, for an icon with an aria-label (close, more).
  iconOnly: 'size-10 pointer-coarse:min-w-11',
};

/** The button's classes, for a link that must look like one (`<Link className={buttonClassName('secondary')}>`). */
export const buttonClassName = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'standard') =>
  cx(base, variants[variant], sizes[size]);

export type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * A disabled button keeps a visible reason as its label, e.g. "Unavailable", never opacity alone.
 * `aria-disabled` follows `disabled` only. `className` is for layout (margin, width, grid placement), not for
 * overriding size, padding or colour: classes are joined, not merged, so use `size` and `variant` instead.
 */
export function Button({
  variant = 'secondary',
  size = 'standard',
  type = 'button',
  disabled,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cx(buttonClassName(variant, size), className)}
      {...props}
      aria-disabled={disabled || undefined}
    />
  );
}
