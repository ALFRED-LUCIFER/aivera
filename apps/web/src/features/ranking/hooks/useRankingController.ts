import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useLiveRefresh } from '@/features/evidence-profile';
import { orderBasis } from '../domain/order.ts';
import {
  FIRST_ROWS,
  HIDDEN_BY_DEFAULT,
  NO_FILTERS,
  filterRows,
  inProgress,
  missingOptions,
  stageOptions,
  topRanked,
  type HideableColumn,
  type RankingData,
  type RankingFilters,
} from '../domain/ranking.ts';
import { compareHref } from '@/features/compare/domain/compare.ts';
import { compareState, parseSelected } from '../domain/selection.ts';
import { replaceSelectedInUrl } from '../services/selectionUrl.ts';

/**
 * The ranked table's search, filters, Columns menu and "Show all". The rows arrive whole from the server; filtering
 * and the first-7 cut happen here. The selection (AIV-P1-036) is client state, read from the URL once and mirrored to
 * it, so it survives the filters, "Show all" and a reload; it is offered only when the server allows a bulk action.
 */
// shortcut: filters live in state, not the URL; move them to the URL if recruiters ask to link a filtered ranking.
export function useRankingController({ jobId, awaitingRubric, rows, bulkActions }: RankingData) {
  const router = useRouter();
  // Read once: useSearchParams does not follow the URL while a server refresh is in flight, so a tick read back from
  // it would not show, and the next tick would start from the stale selection (AIV-P1-149).
  const [picked, setPicked] = useState(useSearchParams().get('selected'));
  const selectedIds = parseSelected(picked, rows);
  const [filters, setFilters] = useState<RankingFilters>(NO_FILTERS);
  const [showAll, setShowAll] = useState(false);
  const [hidden, setHidden] = useState<HideableColumn[]>([...HIDDEN_BY_DEFAULT]);
  const top = bulkActions.includes('compare') ? topRanked(rows) : null;
  const matching = filterRows(rows, filters);
  const shown = showAll ? matching : matching.slice(0, FIRST_ROWS);
  const assessing = inProgress(rows);
  // While a CV is read or assessed, the page refreshes itself until it is scored (AIV-P1-165 §7).
  useLiveRefresh(assessing > 0);
  return {
    status: 'ready' as const,
    jobId,
    awaitingRubric,
    total: rows.length,
    // Of every row, not the filtered ones: the banner is about how the whole ranking was ordered (AIV-P1-165 §9).
    orderBasis: orderBasis(rows),
    matching: matching.length,
    assessed: matching.filter((row) => row.score).length,
    assessing,
    filtered: filters.query.trim() !== '' || filters.stage !== '' || filters.missing !== '',
    rows: shown,
    filters,
    onFiltersChange: (change: Partial<RankingFilters>) => setFilters({ ...filters, ...change }),
    stages: stageOptions(rows),
    missingChoices: missingOptions(rows),
    onShowAll: () => setShowAll(true),
    hidden,
    onToggleColumn: (column: HideableColumn) =>
      setHidden(hidden.includes(column) ? hidden.filter((c) => c !== column) : [...hidden, column]),
    /** "Compare top 3" (AIV-P1-165 §9): opens the comparison of the three highest ranked; null while it is not offered. */
    // compareHref builds the path from opaque ids, which typed routes cannot check.
    compareTopHref: top && (compareHref(jobId, top) as Route),
    selection:
      bulkActions.length > 0
        ? {
            selectedIds,
            onSelectedIdsChange(ids: string[]) {
              setPicked(ids.join(','));
              replaceSelectedInUrl(ids);
            },
            /** Selected rows the filters or the first-7 cut do not show: the bar says so. */
            notShown: selectedIds.filter((id) => !shown.some((row) => row.id === id)).length,
            compare: bulkActions.includes('compare') ? compareState(selectedIds.length) : null,
            // compareHref builds the path from opaque ids, which typed routes cannot check.
            onCompare: () =>
              router.push(
                compareHref(
                  jobId,
                  rows.filter((row) => selectedIds.includes(row.id)).map((row) => row.personId),
                ) as Route,
              ),
          }
        : null,
  };
}
