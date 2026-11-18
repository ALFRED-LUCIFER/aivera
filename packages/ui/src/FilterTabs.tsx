'use client';

import type { KeyboardEvent, ReactNode } from 'react';

export type FilterTab = { value: string; label: ReactNode; count: number };

export type FilterTabsProps = {
  /** Names the group, from i18n, e.g. "Filter applications". */
  label: string;
  tabs: FilterTab[];
  /** The caller keeps this in the URL; the tabs only report a change. */
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Toggle buttons with aria-pressed and a count ("All 5 · Needs your action 2"). They filter one list, so they are a
 * toolbar, not ARIA tabs (no tab panels). One Tab stop; the arrow keys move and select, following the reading direction.
 */
export function FilterTabs({ label, tabs, value, onValueChange }: FilterTabsProps) {
  const at = tabs.findIndex((tab) => tab.value === value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const rtl = event.currentTarget.closest('[dir]')?.getAttribute('dir') === 'rtl';
    const step = (event.key === 'ArrowRight') !== rtl ? 1 : -1;
    const index = (at + step + tabs.length) % tabs.length;
    const next = tabs[index];
    if (!next) return;
    event.preventDefault();
    onValueChange(next.value);
    event.currentTarget.querySelectorAll('button')[index]?.focus();
  };

  return (
    <div
      role="toolbar"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-1 border-b border-border"
    >
      {tabs.map((tab, index) => {
        const pressed = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            aria-pressed={pressed}
            // An unknown value still leaves one Tab stop, on the first tab.
            tabIndex={pressed || (at === -1 && index === 0) ? 0 : -1}
            onClick={() => onValueChange(tab.value)}
            className={
              '-mb-px inline-flex min-h-10 cursor-pointer items-center gap-1.5 border-b-2 px-3 text-body font-semibold ' +
              'transition-colors duration-120 ease-case motion-reduce:transition-none pointer-coarse:min-h-11 ' +
              (pressed ? 'border-action text-text' : 'border-transparent text-text-2 hover:text-text')
            }
          >
            {tab.label}{' '}
            <span className="rounded-full bg-surface-subtle px-1.5 text-meta tabular-nums text-text-2">
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
