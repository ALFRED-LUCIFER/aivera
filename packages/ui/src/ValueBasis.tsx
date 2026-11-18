import { cx } from './cx.ts';

/** AGENTS.md 1.7: every number states its basis. Metric components take `basis: ValueBasisKind` as a required prop. */
export type ValueBasisKind = 'observed' | 'baseline' | 'projection' | 'not-available';

// Foundations artboard .mk-*: solid square, outlined square, dashed square, rule.
const markers: Record<ValueBasisKind, string> = {
  observed: 'size-2.25 rounded-xs bg-text',
  baseline: 'size-2.25 rounded-xs border-2 border-text-2',
  projection: 'size-2.25 rounded-xs border-2 border-dashed border-text',
  'not-available': 'h-0 w-2.25 border-t-2 border-text-3',
};

export type ValueBasisProps = {
  basis: ValueBasisKind;
  /** The word for the basis, e.g. "Observed", from i18n. */
  label: string;
};

export function ValueBasis({ basis, label }: ValueBasisProps) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-tag border border-border bg-surface-subtle px-2 text-meta font-medium whitespace-nowrap text-text-2">
      <span aria-hidden="true" className={cx('inline-block flex-none', markers[basis])} />
      {label}
    </span>
  );
}
