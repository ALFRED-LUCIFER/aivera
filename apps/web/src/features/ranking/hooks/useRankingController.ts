import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  FIRST_ROWS,
  NO_FILTERS,
  filterRows,
  missingOptions,
  stageOptions,
  type HideableColumn,
  type RankingData,
  type RankingFilters,
} from '../domain/ranking.ts';
import { compareHref, compareState, parseSelected } from '../domain/selection.ts';
import { replaceSelectedInUrl } from '../services/selectionUrl.ts';

/**
 * The ranked table's search, filters, Columns menu and "Show all". The rows arrive whole from the server; filtering
 * and the first-7 cut happen here. The selection (AIV-P1-036) is client state, read from the URL once and mirrored to
 * it, so it survives the filters, "Show all" and a reload. It is never read back from the URL: while a server refresh
 * is in flight Next's useSearchParams does not follow the URL, so a tick would not show and the next one would start
 * from the stale selection (AIV-P1-149). It is offered only when the server allows this member a bulk action.
 */
// shortcut: filters live in state, not the URL; move them to the URL if recruiters ask to link a filtered ranking.
export function useRankingController({ jobId, awaitingRubric, rows, bulkActions }: RankingData) {
  const router = useRouter();
  const inUrl = useSearchParams().get('selected');
  const [picked, setPicked] = useState(() => parseSelected(inUrl, rows));
  // Only rows still on the ranking, in rank order: a refresh may bring fewer rows.
  const selectedIds = rows.filter((row) => picked.includes(row.id)).map((row) => row.id);
  const selected = selectedIds.join(',');
  // On the first render too: ids the URL held that are no rows here are dropped from it.
  useEffect(() => replaceSelectedInUrl(selected), [selected]);
  const [filters, setFilters] = useState<RankingFilters>(NO_FILTERS);
  const [showAll, setShowAll] = useState(false);
  const [hidden, setHidden] = useState<HideableColumn[]>([]);
  const matching = filterRows(rows, filters);
  const shown = showAll ? matching : matching.slice(0, FIRST_ROWS);
  return {
    status: 'ready' as const,
    jobId,
    awaitingRubric,
    total: rows.length,
    matching: matching.length,
    assessed: matching.filter((row) => row.score).length,
    shown: shown.filter((row) => row.score).length,
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
    selection:
      bulkActions.length > 0
        ? {
            selectedIds,
            onSelectedIdsChange: setPicked,
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
