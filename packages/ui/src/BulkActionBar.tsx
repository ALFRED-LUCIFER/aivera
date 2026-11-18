'use client';

import { Button } from './Button.tsx';
import { cx } from './cx.ts';

/**
 * AGENTS.md 1.5: a bulk action only builds a preview; the change happens when a person confirms it there (AIV-P0-024).
 * The type rejects a handler that returns nothing or a promise, which is what a direct mutation would return.
 */
export type BulkPreviewHandler<P extends object> = (ids: readonly string[]) => P & { then?: never };

export type BulkAction<P extends object> = { id: string; label: string; preview: BulkPreviewHandler<P> };

export type BulkActionBarProps<P extends object> = {
  selectedIds: readonly string[];
  /** From i18n with the plural, e.g. "2 selected". */
  selectedLabel: string;
  /** From i18n: "Bulk actions always show a preview first." */
  previewNote: string;
  actions: BulkAction<P>[];
  /** Receives the preview an action built; the caller opens the preview-confirm card with it. */
  onPreview: (preview: P) => void;
  /** For layout (margin, sticky placement), not for size or colour. */
  className?: string;
};

/** Shows while rows are selected. The count is a live status, kept mounted so each change is announced. */
export function BulkActionBar<P extends object>({
  selectedIds,
  selectedLabel,
  previewNote,
  actions,
  onPreview,
  className,
}: BulkActionBarProps<P>) {
  const open = selectedIds.length > 0;
  return (
    <div
      className={cx(
        open && 'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border bg-surface p-3 shadow-1',
        className,
      )}
    >
      <output className={open ? 'text-body font-semibold text-text tabular-nums' : 'sr-only'}>
        {open ? selectedLabel : ''}
      </output>
      {open && (
        <>
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button key={action.id} onClick={() => onPreview(action.preview(selectedIds))}>
                {action.label}
              </Button>
            ))}
          </div>
          <p className="text-meta text-text-2">{previewNote}</p>
        </>
      )}
    </div>
  );
}
