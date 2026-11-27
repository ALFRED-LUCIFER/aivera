'use client';

// Built from docs/01-design/artboards/Interviews.dc.html (AIV-P2-002). Deviations:
// - "Guide ready" is not shown: the interview guide does not exist until AIV-P2-003. A scheduled interview says
//   "No guide yet" instead, which is true of every one today (AGENTS.md 1.6: nothing is claimed that cannot be opened).
// - The tabs are the shared FilterTabs (a radio group over one table), not two page links; its count sits in a pill.
// - The table is the shared DataTable: its cell padding and middle alignment, not the artboard's 14 px and top.
// - The summary line says "across 2 jobs", not "roles", and the error and loading texts follow the catalogue's one
//   wording ("We could not load the interviews. Try again.", "Loading interviews…"): packages/i18n's copy rules.
// - The summary line carries an "Observed" basis marker, which the artboard lacks (AGENTS.md 1.7), and is left out
//   until an interview is completed rather than saying "0 interviews".
// - An interview with no time ("Not scheduled yet", owner decision of 24 Nov 2026) is not on the artboard: it shows
//   "No time yet", and a Schedule button for admins and recruiters (AIV-P2-007). A completed row has no action.
// - "Scorecard due, 2 days" is a link to the scorecard, not plain text: nothing moves an interview to "In progress"
//   yet, so a scheduled interview goes straight to due once its time passes, and this is the way to its scorecard.
// - No search field, "Ask Credalent" or assistant panel: the shell leaves them out until they work (AIV-P1-095).
import type { InterviewStatus } from '@credalent/interviews';
import type { Messages } from '@credalent/i18n';
import { useTranslations } from '@credalent/i18n/react';
import {
  Button,
  Chip,
  DataTable,
  FilterTabs,
  SuccessBanner,
  ValueBasis,
  type ChipTone,
  type DataTableColumn,
} from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { createContext, use, type ReactNode } from 'react';
import { parseView, rowAction, VIEWS, type InterviewRow, type InterviewView } from '../domain/interviews.ts';
import type { ScheduleView } from '../domain/schedule.ts';
import { ScheduleDialog } from './ScheduleDialog.tsx';

export type InterviewsListView =
  | { status: 'loading' }
  | { status: 'error'; onRetry: () => void }
  | {
      status: 'ready';
      view: InterviewView;
      onViewChange: (view: InterviewView) => void;
      rows: InterviewRow[];
      counts: Record<InterviewView, number>;
      /** People and jobs the completed interviews cover. */
      people: number;
      jobs: number;
      /** The Schedule dialog, for admins and recruiters; null for anyone else (AIV-P2-007). */
      schedule: ScheduleView | null;
    };

const glyph = (children: ReactNode) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-3.5 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);
// The artboard's two status icons, and a tick for completed.
const clock = glyph(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
);
const microphone = glyph(
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>,
);
const tick = glyph(<path d="m5 12.5 4.5 4.5L19 7.5" />);

// Colour never alone: every status has its icon and its word (DESIGN.md).
const statuses: Record<InterviewStatus, { tone: ChipTone; icon: ReactNode }> = {
  to_schedule: { tone: 'neutral', icon: clock },
  scheduled: { tone: 'neutral', icon: clock },
  in_progress: { tone: 'info', icon: microphone },
  scorecard_due: { tone: 'warn', icon: clock },
  completed: { tone: 'ok', icon: tick },
  cancelled: { tone: 'neutral', icon: clock },
};

// Module-level cell renderers (stable across renders); the component adds the translated headers.
const cells: (Omit<DataTableColumn<InterviewRow>, 'header'> & { id: keyof Messages['interviews']['columns'] })[] = [
  { id: 'candidate', cell: (row) => <CandidateCell row={row} /> },
  { id: 'round', cell: (row) => <RoundCell row={row} /> },
  { id: 'interviewer', cell: (row) => <InterviewerCell row={row} /> },
  { id: 'when', cell: (row) => <WhenCell row={row} /> },
  { id: 'status', cell: (row) => <StatusCell row={row} /> },
  { id: 'competencies', cell: (row) => <span className="text-meta text-text-2">{row.competencies.join(', ')}</span> },
  { id: 'action', cell: (row) => <ActionCell row={row} /> },
];

/** Opens the Schedule dialog for a row; null when this member cannot schedule (AIV-P2-007). */
const OnSchedule = createContext<((row: InterviewRow) => void) | null>(null);

/** Ongoing and completed interviews with what each must investigate (AIV-P2-002). */
export function InterviewsList({ view }: { view: InterviewsListView }) {
  const t = useTranslations('interviews');
  const ready = view.status === 'ready';
  const total = ready ? view.counts.ongoing + view.counts.completed : 0;
  const schedule = ready ? view.schedule : null;
  return (
    <div className="flex flex-col gap-6">
      {schedule && <SuccessBanner>{schedule.done && t('schedule.done')}</SuccessBanner>}
      {ready && (
        <FilterTabs
          label={t('viewsLabel')}
          tabs={VIEWS.map((value) => ({ value, label: t(`views.${value}`), count: view.counts[value] }))}
          value={view.view}
          onValueChange={(value) => view.onViewChange(parseView(value))}
        />
      )}
      <OnSchedule value={schedule?.onOpen ?? null}>
        <DataTable
          caption={t('caption')}
          columns={cells.map((column) => ({ ...column, header: t(`columns.${column.id}`) }))}
          rows={ready ? view.rows : []}
          getRowId={(row) => row.id}
          emptyMessage={
            total === 0 ? t('empty') : t(ready && view.view === 'completed' ? 'emptyCompleted' : 'emptyOngoing')
          }
          loading={view.status === 'loading'}
          loadingLabel={t('loading')}
          {...(view.status === 'error' && {
            error: { message: t('error'), retryLabel: t('retry'), onRetry: view.onRetry },
          })}
        />
      </OnSchedule>
      {schedule && <ScheduleDialog view={schedule} />}
      {ready && view.counts.completed > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-meta text-text-2">
          {t('summary', { count: view.counts.completed, people: view.people, jobs: view.jobs })}
          <ValueBasis basis="observed" label={t('observed')} />
        </p>
      )}
    </div>
  );
}

function CandidateCell({ row }: { row: InterviewRow }) {
  const t = useTranslations('interviews');
  return (
    <>
      <span className="font-semibold">{row.candidate ?? t('unnamed')}</span>
      <span className="block text-meta text-text-2">{row.job}</span>
    </>
  );
}

function RoundCell({ row }: { row: InterviewRow }) {
  const t = useTranslations('interviews');
  return <span className="whitespace-nowrap">{t(`round.${row.round}`)}</span>;
}

function InterviewerCell({ row }: { row: InterviewRow }) {
  const t = useTranslations('interviews');
  return <span className="whitespace-nowrap">{row.interviewer ?? t('you')}</span>;
}

/** In the workspace time zone, which the IntlProvider carries. An overdue interview shows its day only, as the artboard does. */
function WhenCell({ row }: { row: InterviewRow }) {
  const t = useTranslations('interviews');
  if (!row.scheduledAt) return <span className="text-text-2">{t('when.none')}</span>;
  const at = new Date(row.scheduledAt);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {row.today ? t('when.today', { at }) : t(row.status === 'scorecard_due' ? 'when.day' : 'when.at', { at })}
    </span>
  );
}

function StatusCell({ row }: { row: InterviewRow }) {
  const t = useTranslations('interviews');
  return (
    <Chip {...statuses[row.status]} className="whitespace-nowrap">
      {t(`status.${row.status}`)}
    </Chip>
  );
}

function ActionCell({ row }: { row: InterviewRow }) {
  const t = useTranslations('interviews');
  const onSchedule = use(OnSchedule);
  const action = rowAction(row, onSchedule !== null);
  if (!action) return null;
  if (action.kind === 'noGuide') return <span className="whitespace-nowrap text-text-2">{t('noGuide')}</span>;
  if (action.kind === 'schedule')
    return (
      <Button
        onClick={() => onSchedule?.(row)}
        aria-label={t('schedule.openFor', { name: row.candidate ?? t('unnamed') })}
      >
        {t('schedule.open')}
      </Button>
    );
  return (
    // scorecardHref builds the path from the interview id, which typed routes cannot check.
    <Link
      href={action.href as Route}
      className="font-semibold whitespace-nowrap text-text underline underline-offset-2"
    >
      {action.kind === 'openScorecard' ? t('openScorecard') : t('scorecardDueFor', { days: action.days })}
    </Link>
  );
}
