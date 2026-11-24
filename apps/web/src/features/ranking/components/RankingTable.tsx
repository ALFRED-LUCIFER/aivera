'use client';

import type { Messages } from '@credalent/i18n';
import type { Stage } from '@credalent/intake';
import { useTimeZone, useTranslations } from '@credalent/i18n/react';
import {
  Button,
  Checkbox,
  DataTable,
  Input,
  Label,
  LevelMeter,
  ScoreWithUncertainty,
  Select,
  SuccessBanner,
  ValueBasis,
  buttonClassName,
  type DataTableColumn,
} from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { profileHref } from '@/features/evidence-profile/domain/profile.ts';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import type { DuplicatesView } from '../domain/duplicates.ts';
import {
  HIDEABLE_COLUMNS,
  type CandidateRow,
  type CandidateScore,
  type HideableColumn,
  type RankingFilters,
} from '../domain/ranking.ts';
import { DuplicateActions } from './DuplicateActions.tsx';

// AIV-P1-034: the ranked candidates table, from the Candidates artboard (docs/01-design/artboards/Candidates.dc.html).
// Deviations, each for a later ticket or a rule:
// - no "Who is ahead, and how sure are we?" proof map chart: AIV-P1-035 (#99);
// - no compare checkboxes, "3 selected" bulk bar, bulk evidence request preview or "Compare 3 selected" button:
//   selection and bulk actions are AIV-P1-036 (#100);
// - the line under each name is the application's intake stage ("New"), not the interview round ("Round 1 complete"),
//   which interviews and scorecards record (AIV-P2-E01, #18);
// - "Last review" is "Last scored" (owner's decision): when the stored result last changed (an unchanged re-run stores nothing), in the workspace time zone
//   named in the header (AGENTS.md 3.9); it becomes "Last review" with scorecards (AIV-P2-006, #120);
// - "Next action" says "Not yet available": its sources are evidence requests (AIV-P1-039, #103), interview rounds
//   (AIV-P2-007, #121) and decision packs (AIV-P2-010, #124), none built yet, and no value is invented (AGENTS.md 1.7);
// - "Stage: all" and "Missing evidence: any" are native selects, and the Columns menu a disclosure of checkboxes: no
//   menu or popover component exists in @credalent/ui, and a native control keeps its keyboard path;
// - a line under the filters gives the scores' basis, "Observed" (AGENTS.md 1.7), which the artboard does not draw;
// - candidates not yet assessed stay listed after the ranked ones as "Not yet scored" (AGENTS.md 1.5);
// - the intro sits under the stages, not under the title: the job header is shared by every job page (AIV-P1-011);
// - no Credalent assistant panel: the assistant is AIV-P2-028 (#142);
// - admins and recruiters see a row's duplicates under the name (AIV-P1-018; deviations in DuplicateActions.tsx).

export type RankingTableView =
  | { status: 'loading' }
  | { status: 'error'; onRetry: () => void }
  | {
      status: 'ready';
      jobId: string;
      awaitingRubric: boolean;
      /** Every applicant, before filters. */
      total: number;
      /** Rows matching the filters, how many of them are assessed, and how many of those are shown. */
      matching: number;
      assessed: number;
      shown: number;
      /** A search or filter is set, so the counts are of the matching rows only. */
      filtered: boolean;
      /** The rows shown: the first 7 matching until "Show all". */
      rows: CandidateRow[];
      filters: RankingFilters;
      onFiltersChange: (change: Partial<RankingFilters>) => void;
      stages: Stage[];
      missingChoices: string[];
      onShowAll: () => void;
      hidden: HideableColumn[];
      onToggleColumn: (column: HideableColumn) => void;
    };

type ColumnId = keyof Messages['ranking']['columns'];

const scored = (render: (score: CandidateScore) => ReactNode) => (row: CandidateRow) =>
  row.score ? render(row.score) : <NotYet />;

// Module-level cell renderers (stable across renders); the component adds the translated headers.
const cells: (Omit<DataTableColumn<CandidateRow>, 'header'> & { id: ColumnId })[] = [
  { id: 'rank', cell: (row) => <span className="text-text-2 tabular-nums">{row.score?.rank}</span> },
  { id: 'candidate', cell: (row) => <NameCell row={row} /> },
  { id: 'score', cell: (row) => <ScoreCell row={row} /> },
  { id: 'meetsNeed', cell: scored((s) => <MeetsNeedCell score={s} />) },
  { id: 'confidence', cell: scored((s) => <ConfidenceCell score={s} />) },
  { id: 'missing', cell: scored((s) => <MissingCell score={s} />) },
  // shortcut: "Last scored" is the latest assessment; rename it "Last review" and add scorecards with AIV-P2-006 (#120).
  { id: 'lastScored', cell: scored((s) => <ScoredCell score={s} />) },
  // shortcut: no next action until evidence requests (AIV-P1-039), interviews (AIV-P2-007) or packs (AIV-P2-010) ship.
  { id: 'nextAction', cell: () => <NotYet /> },
];

/**
 * Who is ahead and how sure we are. Every applicant stays visible; ranking orders attention (AGENTS.md 1.5).
 * `duplicates` drives the rows' merge and undo previews (AIV-P1-018).
 */
export function RankingTable({ view, duplicates }: { view: RankingTableView; duplicates?: DuplicatesView }) {
  const t = useTranslations('ranking');
  const timeZone = useTimeZone();
  const ready = view.status === 'ready' ? view : null;
  const columns = cells
    .filter((column) => !(ready && isHideable(column.id) && ready.hidden.includes(column.id)))
    .map((column) => ({
      ...column,
      ...(column.id === 'candidate' && ready && { cell: nameCell(ready.jobId, duplicates) }),
      // The date column names the workspace time zone it shows (AGENTS.md 3.9).
      header: column.id === 'lastScored' ? t('lastScoredIn', { timeZone }) : t(`columns.${column.id}`),
    }));

  return (
    <div className="flex flex-col gap-4 self-stretch">
      <p className="max-w-[72ch] text-body text-text-2">{t('intro')}</p>
      {ready?.awaitingRubric && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-border bg-surface-subtle px-3.5 py-3 text-body text-text">
          <span className="font-semibold">{t('awaitingRubric')}</span>
          {/* jobPageHref builds the path from the job id, which typed routes cannot check. */}
          <Link href={jobPageHref(ready.jobId, 'rubric') as Route} className="underline underline-offset-3">
            {t('sendRubric')}
          </Link>
        </p>
      )}
      {duplicates && <SuccessBanner>{duplicates.done && t(`duplicates.done.${duplicates.done}`)}</SuccessBanner>}
      {ready && ready.total > 0 && <Toolbar view={ready} />}
      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={ready?.rows ?? []}
        getRowId={(row) => row.id}
        emptyMessage={ready && ready.total > 0 ? t('emptyFiltered') : t('empty')}
        loading={view.status === 'loading'}
        loadingLabel={t('loading')}
        {...(ready &&
          ready.matching > 0 && {
            footer: (
              <>
                <span>
                  {t('footer', { assessed: ready.assessed, shown: ready.shown, filtered: String(ready.filtered) })}
                </span>
                {ready.rows.length < ready.matching && (
                  <Button size="compact" onClick={ready.onShowAll}>
                    {t('showAll', { count: ready.matching })}
                  </Button>
                )}
              </>
            ),
          })}
        {...(view.status === 'error' && {
          error: { message: t('error'), retryLabel: t('retry'), onRetry: view.onRetry },
        })}
      />
    </div>
  );
}

function Toolbar({ view }: { view: Extract<RankingTableView, { status: 'ready' }> }) {
  const t = useTranslations('ranking');
  const { filters, onFiltersChange } = view;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-80 min-w-55 flex-1">
          <Label htmlFor="ranking-search" className="sr-only">
            {t('search')}
          </Label>
          <svg {...icon} strokeWidth={2} className={iconAt}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <Input
            id="ranking-search"
            type="search"
            className="ps-9"
            placeholder={t('search')}
            value={filters.query}
            onChange={(event) => onFiltersChange({ query: event.target.value })}
          />
        </div>
        <Label htmlFor="ranking-stage" className="sr-only">
          {t('stageFilter')}
        </Label>
        <span className="relative">
          <svg {...icon} strokeWidth={2} className={iconAt}>
            {filterLines}
          </svg>
          <Select
            id="ranking-stage"
            className="w-auto ps-9"
            value={filters.stage}
            onChange={(event) => onFiltersChange({ stage: view.stages.find((s) => s === event.target.value) ?? '' })}
          >
            <option value="">{t('stageAll')}</option>
            {view.stages.map((stage) => (
              <option key={stage} value={stage}>
                {t('stageOption', { stage: t(`stages.${stage}`) })}
              </option>
            ))}
          </Select>
        </span>
        <Label htmlFor="ranking-missing" className="sr-only">
          {t('missingFilter')}
        </Label>
        <span className="relative">
          <svg {...icon} strokeWidth={2} className={iconAt}>
            {filterLines}
          </svg>
          <Select
            id="ranking-missing"
            className="w-auto ps-9"
            value={filters.missing}
            onChange={(event) => onFiltersChange({ missing: event.target.value })}
          >
            <option value="">{t('missingAny')}</option>
            {view.missingChoices.map((name) => (
              <option key={name} value={name}>
                {t('missingOption', { name })}
              </option>
            ))}
          </Select>
        </span>
        {/* shortcut: a native disclosure, so Escape and a click outside do not close it; use a menu component once
            @credalent/ui has one. */}
        <details className="relative ms-auto">
          <summary className={buttonClassName('secondary')}>
            <svg {...icon} className="size-4">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16M15 4v16" />
            </svg>
            {t('columnsMenu')}
          </summary>
          <fieldset className="absolute end-0 z-20 mt-1 flex min-w-56 flex-col rounded-card border border-border bg-surface-raised px-3 py-2 shadow-pop">
            <legend className="sr-only">{t('columnsLegend')}</legend>
            {HIDEABLE_COLUMNS.map((column) => (
              <Checkbox
                key={column}
                checked={!view.hidden.includes(column)}
                onChange={() => view.onToggleColumn(column)}
                label={t(`columns.${column}`)}
              />
            ))}
          </fieldset>
        </details>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-meta text-text-2">
        <ValueBasis basis="observed" label={t('observed')} />
        {t('basis')}
      </p>
    </div>
  );
}

// The artboard's icons (Candidates.dc.html): decorative, as the label names each control.
const icon = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;
const iconAt = 'pointer-events-none absolute start-3 top-3 z-10 size-4 text-text-3';
const filterLines = <path d="M4 6h16M7 12h10M10 18h4" />;
const isHideable = (id: string): id is HideableColumn => HIDEABLE_COLUMNS.some((column) => column === id);

function NotYet() {
  const t = useTranslations('ranking');
  return <ValueBasis basis="not-available" label={t('notYetAvailable')} />;
}

// The candidate cell with the job its profile link opens for and the rows' duplicate actions, built outside render's
// component definitions.
const nameCell = (jobId: string, duplicates?: DuplicatesView) => (row: CandidateRow) => (
  <NameCell row={row} jobId={jobId} duplicates={duplicates} />
);

function NameCell({
  row,
  jobId,
  duplicates,
}: {
  row: CandidateRow;
  jobId?: string;
  duplicates?: DuplicatesView | undefined;
}) {
  const t = useTranslations('ranking');
  const name = row.name ?? t('unnamed');
  return (
    <>
      {jobId ? (
        // profileHref builds the path from opaque ids, which typed routes cannot check.
        <Link
          href={profileHref(row.personId, jobId) as Route}
          className="font-semibold text-text underline-offset-2 hover:underline"
        >
          {name}
        </Link>
      ) : (
        <span className="font-semibold">{name}</span>
      )}
      <span className="block text-meta text-text-2">{t(`stages.${row.stage}`)}</span>
      {row.duplicates && duplicates && (
        <DuplicateActions rowId={row.id} duplicates={row.duplicates} view={duplicates} />
      )}
    </>
  );
}

function ScoreCell({ row }: { row: CandidateRow }) {
  const t = useTranslations();
  if (!row.score)
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {t('ranking.notScored')}
        <NotYet />
      </span>
    );
  return (
    <span className="block min-w-44">
      <ScoreWithUncertainty
        compact
        backed={row.score.backedScore}
        upTo={row.score.upperBound}
        backedLabel={(backed) => t('score.backed', { backed })}
        captionLabel={(backed, upTo) => t('score.backedUpToCompact', { backed, upTo })}
        upToLabel={(upTo) => t('score.upToCompact', { upTo })}
        unavailableLabel={t('score.unavailable')}
      />
    </span>
  );
}

function MeetsNeedCell({ score }: { score: CandidateScore }) {
  const t = useTranslations('ranking');
  return (
    <LevelMeter
      level={score.meetsNeed}
      of={score.competencyCount}
      label={t('meetsNeed', { meets: score.meetsNeed, count: score.competencyCount })}
    />
  );
}

function ConfidenceCell({ score }: { score: CandidateScore }) {
  const t = useTranslations('ranking');
  return t(`confidence.${score.confidence}`);
}

function MissingCell({ score }: { score: CandidateScore }) {
  const t = useTranslations('ranking');
  return (
    <span className="block min-w-36 text-meta text-text-2">
      {score.missing.length > 0 ? score.missing.join('; ') : t('noneMissing')}
    </span>
  );
}

function ScoredCell({ score }: { score: CandidateScore }) {
  const t = useTranslations('ranking');
  return <span className="whitespace-nowrap tabular-nums">{t('scoredOn', { value: score.assessedAt })}</span>;
}
