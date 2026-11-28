'use client';

import type { Messages } from '@credalent/i18n';
import type { Stage } from '@credalent/intake';
import { useTimeZone, useTranslations } from '@credalent/i18n/react';
import {
  BulkActionBar,
  Button,
  Checkbox,
  DataTable,
  Input,
  Label,
  LevelMeter,
  Select,
  StatusBadge,
  SuccessBanner,
  ValueBasis,
  buttonClassName,
  type DataTableColumn,
} from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import type { KeyboardEvent, ReactNode } from 'react';
import { evidenceAnchor, profileHref } from '@/features/evidence-profile/domain/profile.ts';
import { scorecardHref } from '@/features/interviews/domain/interviews.ts';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import type { DuplicatesView } from '../domain/duplicates.ts';
import type { CvRetryView } from '@/features/evidence-profile/domain/cvStatus.ts';
import {
  HIDEABLE_COLUMNS,
  TOP_COMPARED,
  rowName,
  type CandidateRow,
  type CandidateScore,
  type HideableColumn,
  type RankingFilters,
} from '../domain/ranking.ts';
import { chosenOrDecided, type ChooseView } from '../domain/choose.ts';
import { packHref, type PackView } from '../domain/pack.ts';
import { MAX_COMPARE, MIN_COMPARE } from '@/features/compare/domain/compare.ts';
import type { CompareState } from '../domain/selection.ts';
import { AddToPack } from './AddToPack.tsx';
import { ChooseForInterview } from './ChooseForInterview.tsx';
import { DuplicateActions } from './DuplicateActions.tsx';
import { NotYet, ScoreCell } from './ScoreCell.tsx';
import { StageLine } from './StageLine.tsx';

// AIV-P1-034: the ranked candidates table, from the Candidates artboard (docs/01-design/artboards/Candidates.dc.html).
// Deviations, each for a later ticket or a rule:
// - no "Who is ahead, and how sure are we?" proof map chart: AIV-P1-035 (#99);
// - selection and the bulk bar (AIV-P1-036) use the shared DataTable and BulkActionBar: the bar is its own region above
//   the table, shown only while rows are selected, not the table card's top strip; the checkbox column has a
//   "Select all N shown" box where the artboard has a hidden "Compare" header; a row's box is named "Select <name>",
//   not "Select <name> to compare", as it serves every bulk action;
// - Compare takes 2 to 10 selected candidates, not the artboard's 3 (AIV-P1-047, owner decision 26 Nov 2026); outside
//   that, the disabled Compare button reads its reason ("Choose 2 or more to compare"), as a disabled Button does;
// - the bar has "Choose for interview" (AIV-P1-114, deviations in ChooseForInterview.tsx), "Add to decision pack"
//   (AIV-P2-010, deviations in AddToPack.tsx) and "Compare", which opens the comparison page (AIV-P1-047).
//   "Request evidence" and its preview are AIV-P1-038 and AIV-P1-039 (#102,
//   #103), "Message" waits for Message candidates: each ticket adds its button (domain/selection.ts);
// - no "Compare 3 selected" primary button beside "Add candidates": the job header is shared by every job page
//   (AIV-P1-011), and the bar's Compare does the same;
// - only admins and recruiters select: interviewers and hiring owners get no checkboxes (the server decides);
// - the line under each name is the current interview round ("Round 1 on 20 Nov", "Round 1 complete", AIV-P2-007),
//   else the application's intake stage ("New"), not the artboard's "Evidence assessed";
// - "Last review" is "Last scored" (owner's decision): when the stored result last changed (an unchanged re-run stores nothing), in the workspace time zone
//   named in the header (AGENTS.md 3.9); it becomes "Last review" with scorecards (AIV-P2-006, #120);
// - "Next action" says "In shortlist pack" while they are in an undecided pack (AIV-P2-010), which comes after the
//   interview in J3 and so wins, then "Open scorecard" for an interview under way or overdue and "Schedule Round 1" for
//   one with no time (AIV-P2-007) (the artboard's "Round 1 today, 14:00: Open scorecard" waits until it is started),
//   else "Chosen for interview" once a person chose them (AIV-P1-114), otherwise "Not
//   yet available": evidence requests (AIV-P1-039, #103) and the interview guide (AIV-P2-003, "Guide ready") are not
//   built yet, and no value is invented (AGENTS.md 1.7);
// - "Stage: all" and "Missing evidence: any" are native selects, and the Columns menu a disclosure of checkboxes: no
//   menu or popover component exists in @credalent/ui, and a native control keeps its keyboard path; Escape closes it
//   and returns focus to "Columns" (AIV-P1-165 §17);
// - the table opens on "#", name, backed score, meets need and next action; "Weight on Strong evidence" (the artboard's
//   "Confidence": it is the share of the rubric's weight proven by Strong evidence, and says so), "Missing critical
//   evidence" (a count that opens to the competencies) and "Last scored" are in the Columns menu (AIV-P1-165 §9), so the
//   table fits 1280 px without sideways scroll;
// - under each assessed name, one line says what the rank rests on, linking to the cited item on the profile: the
//   competency that adds most to the backed score, or with nothing proven the largest claim, tagged "Claim awaiting
//   validation" (AIV-P1-165 §9, AGENTS.md 1.6); the artboard draws no such line;
// - a candidate not yet scored has one cell saying where the CV is, and the other cells are empty, not seven "Not yet
//   available" pills (AIV-P1-165 §9);
// - "Compare top 3" beside the filters opens the comparison of the three highest ranked (AIV-P1-165 §9), a secondary
//   button: the artboard's primary "Compare 3 selected" is the bulk bar's Compare;
// - a line under the filters gives the scores' basis, "Observed" (AGENTS.md 1.7), which the artboard does not draw;
// - candidates not yet assessed stay listed after the ranked ones (AGENTS.md 1.5), each saying where its CV is with an
//   icon and a word ("Reading the CV…", "We could not read this CV. Try again." with a secondary "Try again",
//   AIV-P1-165 §7 and AIV-P1-134), or "Not yet scored" when nothing is known of a CV; an unnamed applicant shows the
//   CV's file name; "Assessing N CVs" sits above the table while any CV is read or assessed, and the footer counts
//   every row ("5 of 6 assessed");
// - the intro sits under the stages, not under the title: the job header is shared by every job page (AIV-P1-011);
// - when every assessed candidate's backed score is 0, a "Not verified" banner above the intro says the order rests on
//   claims, and the intro states that rule (AIV-P1-165 §9; owner decision (a), 28 Nov: claims still count zero): the artboard draws no such state;
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
      /** The rule that really ordered the rows: 'claims' when every backed score is 0 (AIV-P1-165 §9). */
      orderBasis: 'backed' | 'claims' | 'none';
      /** Rows matching the filters and how many of them are assessed: "5 of 6 assessed" (AIV-P1-165 §7). */
      matching: number;
      assessed: number;
      /** Every row whose CV is being read or assessed: "Assessing N CVs". */
      assessing: number;
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
      /** "Compare top 3": the comparison of the three highest ranked; null while it is not offered. */
      compareTopHref: Route | null;
      /** Null when this member has no bulk action: no checkboxes and no bar (AIV-P1-036). */
      selection: {
        selectedIds: string[];
        onSelectedIdsChange: (ids: string[]) => void;
        notShown: number;
        /** Null while Compare is not offered (its flag). */
        compare: CompareState | null;
        onCompare: () => void;
      } | null;
    };

type ColumnId = keyof Messages['ranking']['columns'];

/** What a bulk action hands the bar's onPreview: which action, and the ids it acts on. */
type BulkPreview = { action: 'choose' | 'pack' | 'compare'; ids: readonly string[] };

// A row not yet scored says where its CV is once, in the score cell; its other cells stay empty (AIV-P1-165 §9).
const scored = (render: (score: CandidateScore) => ReactNode) => (row: CandidateRow) =>
  row.score ? render(row.score) : null;

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
  // shortcut: only packs and "Chosen for interview" so far; evidence requests (AIV-P1-039) and later rounds
  // (AIV-P2-007) add theirs.
  {
    id: 'nextAction',
    cell: (row) =>
      row.score || row.inPack || row.interview || chosenOrDecided(row.stage) ? <NextActionCell row={row} /> : null,
  },
];

/**
 * Who is ahead and how sure we are. Every applicant stays visible; ranking orders attention (AGENTS.md 1.5).
 * `duplicates` drives the rows' merge and undo previews (AIV-P1-018); `choose` and `pack`, when this member may use
 * them, the previews of "Choose for interview" (AIV-P1-114) and "Add to decision pack" (AIV-P2-010).
 */
export function RankingTable({
  view,
  duplicates,
  choose,
  pack,
  retry,
}: {
  view: RankingTableView;
  duplicates?: DuplicatesView;
  choose?: ChooseView | undefined;
  pack?: PackView | undefined;
  /** "Try again" on a CV that could not be read or assessed (AIV-P1-134); a row offers it only when the server allows. */
  retry?: CvRetryView | undefined;
}) {
  const t = useTranslations('ranking');
  const timeZone = useTimeZone();
  const ready = view.status === 'ready' ? view : null;
  const selection = ready?.selection;
  const columns = cells
    .filter((column) => !(ready && isHideable(column.id) && ready.hidden.includes(column.id)))
    .map((column) => ({
      ...column,
      ...(column.id === 'candidate' && ready && { cell: nameCell(ready.jobId, duplicates) }),
      ...(column.id === 'score' && retry && { cell: scoreCell(retry) }),
      // The date column names the workspace time zone it shows (AGENTS.md 3.9).
      header: column.id === 'lastScored' ? t('lastScoredIn', { timeZone }) : t(`columns.${column.id}`),
    }));

  return (
    <div className="flex flex-col gap-4 self-stretch">
      {ready?.orderBasis === 'claims' && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-border bg-surface-subtle px-3.5 py-3 text-body text-text">
          <StatusBadge status="informational" label={t('allZero.tag')} />
          <span className="font-semibold">{t('allZero.banner')}</span>
        </p>
      )}
      <p className="max-w-[72ch] text-body text-text-2">
        {t(ready?.orderBasis === 'claims' ? 'allZero.order' : 'intro')}
      </p>
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
      {choose && <SuccessBanner>{choose.done !== null && t('choose.done', { count: choose.done })}</SuccessBanner>}
      {choose && <ChooseForInterview view={choose} />}
      {pack && ready && (
        <SuccessBanner>
          {pack.done && (
            <>
              {t('pack.done', { count: pack.done.added, name: pack.done.name })}{' '}
              {/* packHref builds the path from opaque ids, which typed routes cannot check. */}
              <Link href={packHref(ready.jobId, pack.done.packId) as Route} className="underline underline-offset-3">
                {t('pack.open')}
              </Link>
            </>
          )}
        </SuccessBanner>
      )}
      {pack && <AddToPack view={pack} />}
      {selection && (
        <BulkActionBar<BulkPreview>
          label={t('bulk.label')}
          selectedIds={selection.selectedIds}
          selectedLabel={t('bulk.selected', { count: selection.selectedIds.length })}
          hiddenLabel={selection.notShown > 0 ? t('bulk.notShown', { count: selection.notShown }) : undefined}
          previewNote={t('bulk.previewNote')}
          actions={[
            ...(choose
              ? [
                  {
                    id: 'chooseForInterview',
                    label: t('bulk.choose'),
                    preview: (ids: readonly string[]) => ({ action: 'choose' as const, ids }),
                  },
                ]
              : []),
            ...(pack
              ? [
                  {
                    id: 'addToPack',
                    label: t('bulk.pack'),
                    preview: (ids: readonly string[]) => ({ action: 'pack' as const, ids }),
                  },
                ]
              : []),
            ...(selection.compare
              ? [
                  {
                    id: 'compare',
                    label: t(`bulk.compare.${selection.compare}`, { min: MIN_COMPARE, max: MAX_COMPARE }),
                    disabled: selection.compare !== 'ready',
                    preview: (ids: readonly string[]) => ({ action: 'compare' as const, ids }),
                  },
                ]
              : []),
          ]}
          // Compare changes nothing: it opens the comparison of the selected candidates. The others open their previews,
          // one at a time, so the view never has two Confirm buttons (AGENTS.md 4: one primary button per view).
          onPreview={({ action, ids }) => {
            if (action === 'compare') return selection.onCompare();
            (action === 'choose' ? pack : choose)?.onCancel();
            (action === 'choose' ? choose : pack)?.onPreview(ids);
          }}
        />
      )}
      {ready && ready.assessing > 0 && (
        <output className="flex flex-wrap items-center gap-2 text-body text-text">
          <StatusBadge status="informational" label={t('assessing', { count: ready.assessing })} />
        </output>
      )}
      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={ready?.rows ?? []}
        getRowId={(row) => row.id}
        {...(selection && {
          selection: {
            selectedIds: selection.selectedIds,
            onSelectedIdsChange: selection.onSelectedIdsChange,
            allLabel: t('bulk.selectAll', { count: ready?.rows.length ?? 0 }),
            rowLabel: (row: CandidateRow) => t('bulk.selectRow', { name: rowName(row, t('unnamed')) }),
          },
        })}
        emptyMessage={ready && ready.total > 0 ? t('emptyFiltered') : t('empty')}
        loading={view.status === 'loading'}
        loadingLabel={t('loading')}
        {...(ready &&
          ready.matching > 0 && {
            footer: (
              <>
                <span>
                  {t('footer', { assessed: ready.assessed, total: ready.matching, filtered: String(ready.filtered) })}
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
        {view.compareTopHref && (
          <Link href={view.compareTopHref} className={`${buttonClassName('secondary')} ms-auto`}>
            {t('compareTop', { count: TOP_COMPARED })}
          </Link>
        )}
        {/* shortcut: a native disclosure, so a click outside does not close it; use a menu component once
            @credalent/ui has one. */}
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape bubbles up from the
            summary and the checkboxes inside; the disclosure itself takes no other input */}
        <details className={view.compareTopHref ? 'relative' : 'relative ms-auto'} onKeyDown={closeOnEscape}>
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

/** Escape closes the Columns menu and returns focus to its button (AIV-P1-165 §17). */
function closeOnEscape(event: KeyboardEvent<HTMLDetailsElement>) {
  const menu = event.currentTarget;
  if (event.key !== 'Escape' || !menu.open) return;
  menu.open = false;
  menu.querySelector('summary')?.focus();
}

// The candidate cell with the job its profile link opens for and the rows' duplicate actions, built outside render's
// component definitions.
const nameCell = (jobId: string, duplicates?: DuplicatesView) => (row: CandidateRow) => (
  <NameCell row={row} jobId={jobId} duplicates={duplicates} />
);
const scoreCell = (retry: CvRetryView) => (row: CandidateRow) => <ScoreCell row={row} retry={retry} />;

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
  const name = rowName(row, t('unnamed'));
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
      <span className="block text-meta text-text-2">
        <StageLine row={row} />
      </span>
      {jobId && row.score?.reason && <ReasonLine reason={row.score.reason} personId={row.personId} jobId={jobId} />}
      {row.duplicates && duplicates && (
        <DuplicateActions rowId={row.id} duplicates={row.duplicates} view={duplicates} />
      )}
    </>
  );
}

/**
 * Why the row ranks where it does, in one line citing the evidence item on the profile (AIV-P1-165 §9). A claim is
 * tagged a claim and said to count 0: it never reads as backing (AGENTS.md 1.6).
 */
function ReasonLine({
  reason,
  personId,
  jobId,
}: {
  reason: NonNullable<CandidateScore['reason']>;
  personId: string;
  jobId: string;
}) {
  const t = useTranslations();
  return (
    <span className="mt-1 flex max-w-[64ch] flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-text-2">
      {/* Neutral words, as on the profile and in Compare: the amber pill read as a failed check (#677 §10, §11). */}
      {reason.claim && <span className="font-semibold text-text">{t('evidence.provenance.claim')}</span>}
      <span>
        {t(reason.claim ? 'ranking.reason.claim' : 'ranking.reason.backed')}{' '}
        {/* Built from opaque ids, which typed routes cannot check. */}
        <Link
          href={`${profileHref(personId, jobId)}#${evidenceAnchor(reason.itemId)}` as Route}
          className="text-text underline underline-offset-2"
        >
          {reason.competency}
        </Link>
        {t(reason.claim ? 'ranking.reason.claimLevel' : 'ranking.reason.backedLevel', { level: reason.level })}
      </span>
    </span>
  );
}

export function MeetsNeedCell({ score }: { score: CandidateScore }) {
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
  if (score.missing.length === 0) return <span className="text-meta text-text-2">{t('noneMissing')}</span>;
  // A native disclosure: the count opens to the competencies, by mouse or keyboard (AIV-P1-165 §9).
  return (
    <details className="min-w-36 text-meta text-text-2">
      <summary className="cursor-pointer rounded-xs text-text underline underline-offset-2">
        {t('missingCount', { count: score.missing.length })}
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {score.missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </details>
  );
}

export function NextActionCell({ row }: { row: CandidateRow }) {
  const t = useTranslations('ranking');
  if (row.inPack) return <span>{t('pack.inPack')}</span>;
  // AIV-P2-007: an interview under way or overdue opens its scorecard; one with no time is scheduled on Interviews.
  const { interview } = row;
  if (interview?.status === 'in_progress' || interview?.status === 'scorecard_due')
    return (
      // scorecardHref builds the path from the interview id, which typed routes cannot check.
      <Link
        href={scorecardHref(interview.id) as Route}
        className="font-semibold text-text underline underline-offset-2"
      >
        {t('openScorecard')}
      </Link>
    );
  if (interview?.status === 'to_schedule')
    return (
      <Link href="/app/interviews" className="font-semibold text-text underline underline-offset-2">
        {t('scheduleRound', { round: t(`roundShort.${interview.round}`) })}
      </Link>
    );
  // Chosen for interview, or past Round 1 by the hiring owner's decision (AIV-P2-012): the stage is the next action's state.
  return chosenOrDecided(row.stage) ? <span>{t(`stages.${row.stage}`)}</span> : <NotYet />;
}

function ScoredCell({ score }: { score: CandidateScore }) {
  const t = useTranslations('ranking');
  return <span className="whitespace-nowrap tabular-nums">{t('scoredOn', { value: score.assessedAt })}</span>;
}
