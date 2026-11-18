import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.ts';

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode };

/** A native checkbox inside its label, so the whole row is the target; checked state is drawn in ink. */
export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return (
    <label
      className={cx(
        'inline-flex min-h-10 cursor-pointer items-center gap-2 text-body text-text pointer-coarse:min-h-11',
        'has-disabled:cursor-not-allowed has-disabled:text-text-3',
        className,
      )}
    >
      <input type="checkbox" className="size-4 cursor-pointer accent-action disabled:cursor-not-allowed" {...props} />
      {label}
    </label>
  );
}
