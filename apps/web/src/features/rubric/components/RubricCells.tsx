import type { Competency } from '@credalent/jobs';
import { useTranslations } from '@credalent/i18n/react';
import { Button, Chip, Input, Select, type DataTableColumn } from '@credalent/ui';
import type { RubricEditorView } from '../domain/rubric.ts';

/** A competency row; `editor` is set while the rubric is in edit mode (AIV-P1-013). */
export type Row = Competency & { id: string; index: number; editor: RubricEditorView | null };

const LEVELS = [1, 2, 3, 4, 5] as const;
const TYPES = ['mandatory', 'desirable'] as const;

// Module-level cell renderers (stable across renders); the table adds the translated headers.
export const cells: (Omit<DataTableColumn<Row>, 'header'> & { id: 'competency' | 'weight' | 'level' | 'type' })[] = [
  { id: 'competency', cell: (row) => <CompetencyCell row={row} /> },
  { id: 'weight', numeric: true, cell: (row) => <WeightCell row={row} /> },
  { id: 'level', cell: (row) => <LevelCell row={row} /> },
  { id: 'type', cell: (row) => <TypeCell row={row} /> },
];

const label = (row: Row, unnamed: string) => row.name.trim() || unnamed;

function CompetencyCell({ row }: { row: Row }) {
  const t = useTranslations('rubric');
  const { editor } = row;
  // A competency added in edit mode is named here; one already agreed keeps its name and evidence.
  const naming = editor && row.origin === 'added_by_recruiter';
  return (
    <div className="flex min-w-60 items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {naming ? (
          <>
            <Input
              aria-label={t('edit.name', { number: row.index + 1 })}
              value={row.name}
              maxLength={200}
              onChange={(e) => editor.onChange(row.index, { name: e.target.value })}
            />
            <Input
              aria-label={t('edit.evidence', { number: row.index + 1 })}
              value={row.evidenceExpected}
              maxLength={1000}
              onChange={(e) => editor.onChange(row.index, { evidenceExpected: e.target.value })}
            />
          </>
        ) : (
          <>
            <div className="font-semibold">{row.name}</div>
            <div className="text-meta text-text-2">{row.evidenceExpected}</div>
          </>
        )}
        {row.origin === 'suggested_by_aivera' && <Chip className="mt-0.5">{t('suggestedAccepted')}</Chip>}
      </div>
      {editor && (
        <Button variant="ghost" size="compact" onClick={() => editor.onRemove(row.index)}>
          {t('edit.remove', { name: label(row, t('edit.unnamed')) })}
        </Button>
      )}
    </div>
  );
}

function WeightCell({ row }: { row: Row }) {
  const t = useTranslations('rubric');
  if (!row.editor) return t('weight', { weight: row.weightPercent });
  const { editor } = row;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={100}
        aria-label={t('edit.weight', { name: label(row, t('edit.unnamed')) })}
        value={row.weightPercent || ''}
        className="w-19 text-end tabular-nums"
        onChange={(e) => editor.onChange(row.index, { weightPercent: Math.trunc(Number(e.target.value)) || 0 })}
      />
      <span aria-hidden="true" className="text-text-2">
        {t('percentSign')}
      </span>
    </span>
  );
}

function LevelCell({ row }: { row: Row }) {
  const t = useTranslations('rubric');
  if (!row.editor) return t('level', { level: row.levelNeeded });
  const { editor } = row;
  return (
    <Select
      aria-label={t('edit.level', { name: label(row, t('edit.unnamed')) })}
      value={row.levelNeeded}
      className="min-w-28"
      onChange={(e) => editor.onChange(row.index, { levelNeeded: Number(e.target.value) })}
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
  const t = useTranslations('rubric');
  if (!row.editor) return t(`type.${row.type}`);
  const { editor } = row;
  return (
    <Select
      aria-label={t('edit.type', { name: label(row, t('edit.unnamed')) })}
      value={row.type}
      className="min-w-32"
      onChange={(e) => editor.onChange(row.index, { type: TYPES.find((type) => type === e.target.value) ?? row.type })}
    >
      {TYPES.map((type) => (
        <option key={type} value={type}>
          {t(`type.${type}`)}
        </option>
      ))}
    </Select>
  );
}
