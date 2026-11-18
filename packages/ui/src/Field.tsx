import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx.ts';

// Native elements keep the platform's keyboard, autofill and mobile pickers; tokens do the styling.
const field =
  'w-full rounded-control border border-border-strong bg-surface px-3 text-body text-text placeholder:text-text-3 ' +
  'transition-colors duration-120 ease-case motion-reduce:transition-none hover:border-text-3 ' +
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-subtle disabled:text-text-3 ' +
  'aria-invalid:border-err-text';

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...props }: LabelProps) {
  // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the caller passes htmlFor; this is the shared wrapper
  return <label className={cx('text-meta font-semibold text-text', className)} {...props} />;
}

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, type = 'text', ...props }: InputProps) {
  return <input type={type} className={cx(field, 'h-10 pointer-coarse:min-h-11', className)} {...props} />;
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  return <textarea rows={rows} className={cx(field, 'py-2', className)} {...props} />;
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode };

/** A native select: options are `<option>` children with their text from props or i18n. */
export function Select({ className, ...props }: SelectProps) {
  return (
    <span className="relative block">
      <select
        className={cx(field, 'h-10 cursor-pointer appearance-none pe-9 pointer-coarse:min-h-11', className)}
        {...props}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-text-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="m4 6 4 4 4-4" />
      </svg>
    </span>
  );
}
