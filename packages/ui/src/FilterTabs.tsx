'use client';

import type { ReactNode } from 'react';
import { Choices, type Look } from './RadioGroup.tsx';

export type FilterTab = { value: string; label: ReactNode; count: number };

export type FilterTabsProps = {
  /** Names the group for assistive technology, from i18n, e.g. "Filter applications". */
  label: string;
  tabs: FilterTab[];
  /** The caller keeps this in the URL; the tabs only report a change. */
  value: string;
  /** Fires on every arrow press, so update the URL with router.replace, not push, or each press adds history. */
  onValueChange: (value: string) => void;
};

// The same native radio group as SegmentedControl, drawn as an underlined tab row.
const tabsLook: Look = {
  legend: 'sr-only',
  list: 'flex flex-wrap gap-1 border-b border-border',
  option:
    '-mb-px inline-flex min-h-10 cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-3 text-body ' +
    'font-semibold text-text-2 transition-colors duration-120 ease-case motion-reduce:transition-none ' +
    'pointer-coarse:min-h-11 hover:text-text has-checked:border-action has-checked:text-text ' +
    'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus',
  input: 'sr-only',
};

/**
 * Filter tabs with counts ("All 5 · Needs your action 2"). They filter one list and have no tab panels, so they are a
 * native radio group: one Tab stop, and the arrow keys move and select in the reading direction, with no custom code.
 */
export function FilterTabs({ label, tabs, value, onValueChange }: FilterTabsProps) {
  return (
    <Choices
      look={tabsLook}
      legend={label}
      value={value}
      onValueChange={onValueChange}
      options={tabs.map((tab) => ({
        value: tab.value,
        label: (
          <>
            {tab.label}{' '}
            <span className="rounded-full bg-surface-subtle px-1.5 text-meta tabular-nums text-text-2">
              {tab.count}
            </span>
          </>
        ),
      }))}
    />
  );
}
