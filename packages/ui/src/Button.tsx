import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'compact' | 'standard';

// DESIGN.md: 40 px standard, 36 px compact, 44 px on any coarse pointer; one primary per view.
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
  standard: 'h-10 px-3.5 text-sm',
  compact: 'h-9 px-3 text-meta',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

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
      className={[base, variants[variant], sizes[size], className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
