'use client';

import { useId, type ReactNode } from 'react';
import { cx } from './cx.ts';

export type ChoiceOption = { value: string; label: ReactNode; disabled?: boolean };

export type RadioGroupProps = {
  legend: ReactNode;
  options: ChoiceOption[];
  name?: string;
  /** Controlled value; leave undefined and use defaultValue for an uncontrolled group. */
  value?: string;
  defaultValue?: string;
  /** Fires on every arrow press as well as clicks, so do not save on each change; save on submit. */
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  'aria-invalid'?: boolean;
  /** Id of a hint or error message for the group. */
  'aria-describedby'?: string;
  /** For layout (margin, width, grid placement), not for size, padding or colour. */
  className?: string;
};

type Look = { list: string; option: string; input: string };

const radio: Look = {
  list: 'flex flex-col',
  option:
    'inline-flex min-h-10 cursor-pointer items-center gap-2 text-body text-text pointer-coarse:min-h-11 ' +
    'has-disabled:cursor-not-allowed has-disabled:text-text-3',
  input: 'size-4 cursor-pointer accent-action disabled:cursor-not-allowed',
};

// The radio input is visually hidden, so its option draws the focus ring (DESIGN.md: 2 px --focus, offset 2 px).
// A checked option of a disabled group (a submitted scorecard) keeps readable text: ink on surface with a strong
// border, since text-3 on the action ground is under 4.5:1. The stacked variant wins over has-disabled alone.
const segmented: Look = {
  list: 'inline-flex flex-wrap gap-1 rounded-control bg-surface-subtle',
  option:
    'inline-flex min-h-10 cursor-pointer items-center rounded-control border border-transparent px-3 text-meta ' +
    'font-semibold text-text-2 transition-colors duration-120 ease-case motion-reduce:transition-none ' +
    'pointer-coarse:min-h-11 hover:text-text has-checked:bg-action has-checked:text-on-action ' +
    'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus ' +
    'has-disabled:cursor-not-allowed has-disabled:text-text-3 ' +
    'has-checked:has-disabled:border-border-strong has-checked:has-disabled:bg-surface has-checked:has-disabled:text-text',
  input: 'sr-only',
};

function Choices({
  legend,
  options,
  name,
  value,
  defaultValue,
  onValueChange,
  disabled,
  required,
  className,
  look,
  ...aria
}: RadioGroupProps & { look: Look }) {
  const groupName = useId();
  return (
    <fieldset role="radiogroup" disabled={disabled} className={cx('min-w-0', className)} {...aria}>
      <legend className="mb-2 text-meta font-semibold text-text">{legend}</legend>
      <div className={look.list}>
        {options.map((option) => (
          <label key={option.value} className={look.option}>
            <input
              type="radio"
              name={name ?? groupName}
              value={option.value}
              disabled={option.disabled}
              required={required}
              className={look.input}
              {...(value === undefined
                ? { defaultChecked: option.value === defaultValue }
                : { checked: option.value === value })}
              onChange={() => onValueChange?.(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Native radios in a fieldset: arrow keys move and select, Space selects, the legend names the group. */
export function RadioGroup(props: RadioGroupProps) {
  return <Choices {...props} look={radio} />;
}

/** The same radio group drawn as segments, e.g. "Not shown / Partly shown / Clearly shown / Strongly shown". */
export function SegmentedControl(props: RadioGroupProps) {
  return <Choices {...props} look={segmented} />;
}
