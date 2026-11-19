import { useTranslations } from '@aivera/i18n/react';
import { Button, Chip, DataTable, EvidenceHighlight, Input, Select, Textarea, type DataTableColumn } from '@aivera/ui';
import { weightsTotal, type DraftCompetency, type DraftResult, type DraftRow } from '../domain/draft.ts';

type RowHandlers = {
  onEdit: (id: string) => void;
  onDone: () => void;
  onChange: (id: string, change: Partial<DraftCompetency>) => void;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
};

type CompetencyDraftProps = RowHandlers & {
  result: DraftResult;
  rows: readonly DraftRow[];
  editingId: string | null;
  drafting: boolean;
  /** The title as typed, for "Aivera reads the description for a Senior AI Engineer". */
  title: string;
  /** The chosen job type's "Evidence that counts" line, translated; null before a job type is chosen. */
  evidence: string | null;
  onAdd: () => void;
  onUseStarters: () => void;
};

type Row = DraftRow & { editing: boolean; on: RowHandlers };

const LEVELS = [1, 2, 3, 4, 5] as const;
// Stable, so it runs once when the field mounts (Edit or Add competency), not on every render.
const focusOnMount = (element: HTMLInputElement | null) => element?.focus();

// Module-level cell renderers (stable across renders); the component adds the translated headers.
const cells: (Omit<DataTableColumn<Row>, 'header'> & { id: 'competency' | 'weight' | 'level' | 'type' | 'actions' })[] =
  [
    { id: 'competency', cell: (row) => <CompetencyCell row={row} /> },
    { id: 'weight', numeric: true, cell: (row) => <WeightCell row={row} /> },
    { id: 'level', cell: (row) => <LevelCell row={row} /> },
    { id: 'type', cell: (row) => <TypeCell row={row} /> },
    { id: 'actions', cell: (row) => <ActionsCell row={row} /> },
  ];

/** Add a job, step 2 "Competencies, drafted and suggested" (RoleNew artboard, AIV-P1-008, AIV-P1-009). */
export function CompetencyDraft(props: CompetencyDraftProps) {
  const t = useTranslations('jobDraft');
  const tJob = useTranslations('jobNew');
  const { result, rows } = props;
  const columns = cells.map((column) => ({ ...column, header: t(`columns.${column.id}`) }));
  const on = {
    onEdit: props.onEdit,
    onDone: props.onDone,
    onChange: props.onChange,
    onRemove: props.onRemove,
    onRestore: props.onRestore,
  };
  const toRows = (list: DraftRow[]) => list.map((row) => ({ ...row, editing: row.id === props.editingId, on }));
  const suggested = rows.filter((row) => row.origin === 'suggested_by_aivera');
  const own = rows.filter((row) => row.origin !== 'suggested_by_aivera');
  const kept = (origin: DraftRow['origin']) => rows.filter((row) => row.origin === origin && !row.removed).length;
  const drafted = result.status === 'drafted';
  const total = weightsTotal(rows);
  const notice = {
    idle: props.title.trim() ? t('before', { title: props.title.trim() }) : t('beforeUntitled'),
    invalid: null,
    empty: t('empty'),
    drafted: drafted && !result.competencies.some((c) => c.origin === 'from_description') ? t('none') : null,
    failed: t('failed'),
    budget: t('budget'),
  }[result.status];
  const alert = result.status === 'failed' || result.status === 'budget';

  return (
    <section aria-labelledby="job-draft-heading" aria-busy={props.drafting} className="mt-8 flex flex-col gap-3">
      <h2 id="job-draft-heading" className="font-display text-section text-text">
        {t('heading')}
      </h2>
      {/* Announces the wait: the Draft button's label changes too, but a label change is not read out. */}
      <output className="sr-only">{props.drafting ? tJob('drafting') : ''}</output>
      {notice && (
        <p
          role={alert ? 'alert' : undefined}
          className={alert ? 'text-body font-semibold text-text' : 'text-body text-text-2'}
        >
          {notice}
        </p>
      )}
      {drafted && (
        <h3 className="text-body font-semibold text-text">
          {t('fromDescription', { count: kept('from_description') })}
        </h3>
      )}
      {drafted && result.leftOutNonSkill && <p className="text-body text-text">{t('leftOut')}</p>}
      {(own.length > 0 || drafted) && (
        <DataTable
          caption={t('caption')}
          columns={columns}
          rows={toRows(own)}
          getRowId={(row) => row.id}
          emptyMessage={t('noRows')}
        />
      )}
      {drafted && (
        <h3 className="mt-3 text-body font-semibold text-text">
          {t('suggestions', { count: kept('suggested_by_aivera') })}
        </h3>
      )}
      {drafted && suggested.length === 0 && <p className="text-body text-text-2">{t('noSuggestions')}</p>}
      {suggested.length > 0 && (
        <DataTable
          caption={t('suggestionsCaption')}
          columns={columns}
          rows={toRows(suggested)}
          getRowId={(row) => row.id}
          emptyMessage={t('noRows')}
        />
      )}
      {rows.some((row) => !row.removed) && (
        <p className="text-meta font-semibold text-text">
          {total === 100 ? t('weightsTotal', { total }) : t('rebalance')}
        </p>
      )}
      {props.evidence && (
        <dl className="flex flex-wrap gap-x-2 text-meta">
          <dt className="font-semibold text-text">{t('evidenceCounts')}</dt>
          <dd className="text-text-2">{props.evidence}</dd>
        </dl>
      )}
      {result.status !== 'idle' && result.status !== 'invalid' && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={props.onAdd}>{t('add')}</Button>
          {rows.every((row) => row.removed) && <Button onClick={props.onUseStarters}>{t('useStarters')}</Button>}
        </div>
      )}
      {rows.length > 0 && <p className="text-meta text-text-2">{t('notSaved')}</p>}
    </section>
  );
}

function useFieldLabel(row: Row) {
  const t = useTranslations('jobDraft');
  return (label: string) => ({ 'aria-label': `${label}, ${row.name || t('newCompetency')}` });
}

function CompetencyCell({ row }: { row: Row }) {
  const t = useTranslations('jobDraft');
  const label = useFieldLabel(row);
  if (row.editing)
    return (
      <div className="flex min-w-60 flex-col gap-2">
        <Input
          {...label(t('fields.name'))}
          ref={focusOnMount}
          value={row.name}
          maxLength={120}
          onChange={(e) => row.on.onChange(row.id, { name: e.target.value })}
        />
        <Textarea
          {...label(t('fields.evidence'))}
          rows={2}
          value={row.evidenceExpected}
          maxLength={400}
          onChange={(e) => row.on.onChange(row.id, { evidenceExpected: e.target.value })}
        />
      </div>
    );
  if (row.removed)
    return <output className="text-text-2">{t('removed', { name: row.name || t('newCompetency') })}</output>;
  return (
    <div className="flex max-w-xl flex-col items-start gap-1">
      {row.origin === 'suggested_by_aivera' && <Chip>{t('suggestedBy')}</Chip>}
      <span className="font-semibold text-text">{row.name || t('newCompetency')}</span>
      {row.why !== null && <span className="text-meta text-text">{t('why', { why: row.why })}</span>}
      {row.evidenceExpected && (
        <span className="text-meta text-text-2">
          {row.origin !== 'suggested_by_aivera'
            ? row.evidenceExpected
            : t('evidenceExpected', { evidence: row.evidenceExpected })}
        </span>
      )}
      {row.excerpts.map((excerpt) => (
        <p key={`${excerpt.start}-${excerpt.end}`} className="text-meta text-text-2">
          {t('citedFrom')}{' '}
          <EvidenceHighlight
            text={excerpt.text}
            citations={[{ start: excerpt.start, end: excerpt.end, sourceId: 'description' }]}
            markLabel={t('markLabel')}
          />
        </p>
      ))}
    </div>
  );
}

function WeightCell({ row }: { row: Row }) {
  const t = useTranslations('jobDraft');
  const label = useFieldLabel(row);
  if (row.removed) return null;
  if (!row.editing) return t('weight', { weight: row.weightPercent });
  return (
    <Input
      {...label(t('fields.weight'))}
      type="number"
      inputMode="numeric"
      min={1}
      max={100}
      className="w-20"
      value={row.weightPercent}
      onChange={(e) => row.on.onChange(row.id, { weightPercent: e.target.valueAsNumber || 0 })}
    />
  );
}

function LevelCell({ row }: { row: Row }) {
  const t = useTranslations('jobDraft');
  const label = useFieldLabel(row);
  if (row.removed) return null;
  if (!row.editing) return t('level', { level: row.levelNeeded });
  return (
    <Select
      {...label(t('fields.level'))}
      value={row.levelNeeded}
      onChange={(e) => row.on.onChange(row.id, { levelNeeded: Number(e.target.value) })}
    >
      {LEVELS.map((level) => (
        <option key={level} value={level}>
          {t('level', { level })}
        </option>
      ))}
    </Select>
  );
}

function TypeCell({ row }: { row: Row }) {
  const t = useTranslations('jobDraft');
  const label = useFieldLabel(row);
  if (row.removed) return null;
  if (!row.editing) return t(`types.${row.type}`);
  return (
    <Select
      {...label(t('fields.type'))}
      value={row.type}
      onChange={(e) => row.on.onChange(row.id, { type: e.target.value === 'desirable' ? 'desirable' : 'mandatory' })}
    >
      <option value="mandatory">{t('types.mandatory')}</option>
      <option value="desirable">{t('types.desirable')}</option>
    </Select>
  );
}

function ActionsCell({ row }: { row: Row }) {
  const t = useTranslations('jobDraft');
  const name = row.name || t('newCompetency');
  return (
    <div className="flex gap-2">
      {/* One button for Edit and Done, so focus stays on it when editing ends. */}
      {!row.removed && (
        <Button
          size="compact"
          aria-label={row.editing ? undefined : t('edit', { name })}
          onClick={() => (row.editing ? row.on.onDone() : row.on.onEdit(row.id))}
        >
          {row.editing ? t('done') : t('editAction')}
        </Button>
      )}
      {/* One button for Remove and Restore, in the same place, so focus stays on it. */}
      <Button
        size="compact"
        variant="ghost"
        aria-label={row.removed ? t('restore', { name }) : t('remove', { name })}
        onClick={() => (row.removed ? row.on.onRestore(row.id) : row.on.onRemove(row.id))}
      >
        {row.removed ? t('restoreAction') : t('removeAction')}
      </Button>
    </div>
  );
}
