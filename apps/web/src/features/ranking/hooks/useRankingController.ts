import { useState } from 'react';
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

/**
 * The ranked table's search, filters, Columns menu and "Show all". The rows arrive whole from the server; filtering
 * and the first-7 cut happen here.
 */
// shortcut: filters live in state, not the URL; move them to the URL if recruiters ask to link a filtered ranking.
export function useRankingController({ jobId, awaitingRubric, rows }: RankingData) {
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
  };
}
