import type { ReactNode } from 'react';
import { ValueBasis, type ValueBasisKind } from './ValueBasis.tsx';

export type StatTileProps = {
  /** What is counted, e.g. "Workspaces waiting for approval", from i18n. */
  label: string;
  /** The formatted figure, e.g. "3". `null` when there is no figure: the tile says so in words and never shows 0. */
  value: string | null;
  /** AGENTS.md 1.7: every number states its basis. A null value is always "not-available". */
  basis: Exclude<ValueBasisKind, 'not-available'>;
  /** The word for the basis ("Observed") and the words for no figure ("Not yet available"), from i18n. */
  basisLabel: string;
  notAvailableLabel: string;
  /** One line under the figure: what it rests on ("oldest waiting 2 days"). */
  detail?: ReactNode;
  /** A link to act on the figure (a Next.js `<Link>` or `<a>`), shown at the foot of the tile. */
  action?: ReactNode;
  /** The figure could not be read: "We could not load … Try again." in place of the figure, its marker and detail. */
  error?: string;
};

/**
 * One figure with its label and basis marker, for console and dashboard rows (Main artboard metrics: 20/26 tabular
 * figure, `sub` detail line, "View" link). Ink only: a tile is never coloured by whether the figure is good or bad.
 */
export function StatTile({ label, value, basis, basisLabel, notAvailableLabel, detail, action, error }: StatTileProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-1">
      <p className="text-meta font-semibold text-text-2">{label}</p>
      {error ? (
        <p className="text-body text-text">{error}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {value !== null && (
              <span className="font-display text-section font-semibold text-text tabular-nums">{value}</span>
            )}
            {/* No figure: the marker's words alone say so, never a 0. */}
            {value === null ? (
              <ValueBasis basis="not-available" label={notAvailableLabel} />
            ) : (
              <ValueBasis basis={basis} label={basisLabel} />
            )}
          </div>
          {detail && <p className="text-meta text-text-2">{detail}</p>}
        </>
      )}
      {action && <div className="mt-auto pt-1 text-body font-medium">{action}</div>}
    </div>
  );
}
