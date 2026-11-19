'use client';

import type { Competency } from '@aivera/jobs';
import { useTranslations } from '@aivera/i18n/react';
import { Card, Chip, DataTable, StatusBadge, StrengthMeter, type DataTableColumn } from '@aivera/ui';
import { STRENGTHS, weightsTotal, type RubricView } from '../domain/rubric.ts';

export type RubricState =
  { status: 'loading' } | { status: 'error'; onRetry: () => void } | { status: 'ready'; rubric: RubricView };

type Row = Competency & { id: string };

// Module-level cell renderers (stable across renders); the component adds the translated headers.
const cells: (Omit<DataTableColumn<Row>, 'header'> & { id: 'competency' | 'weight' | 'level' | 'type' })[] = [
  { id: 'competency', cell: (c) => <CompetencyCell c={c} /> },
  { id: 'weight', numeric: true, cell: (c) => <Text id="weight" values={{ weight: c.weightPercent }} /> },
  { id: 'level', cell: (c) => <Text id="level" values={{ level: c.levelNeeded }} /> },
  { id: 'type', cell: (c) => <Text id={`type.${c.type}`} /> },
];

function Text({ id, values }: { id: 'weight' | 'level' | `type.${Row['type']}`; values?: Record<string, number> }) {
  const t = useTranslations('rubric');
  return t(id, values);
}

function CompetencyCell({ c }: { c: Row }) {
  const t = useTranslations('rubric');
  return (
    <div className="min-w-60">
      <div className="font-semibold">{c.name}</div>
      <div className="text-meta text-text-2">{c.evidenceExpected}</div>
      {c.origin === 'suggested_by_aivera' && <Chip className="mt-1.5">{t('suggestedAccepted')}</Chip>}
    </div>
  );
}

/** The job's rubric, read view (AIV-P1-012): agreed competencies, what success means, scoring and approval history. */
export function Rubric({ state }: { state: RubricState }) {
  const t = useTranslations('rubric');
  const rubric = state.status === 'ready' ? state.rubric : null;
  const rows: Row[] = rubric?.shown?.competencies.map((c, i) => ({ ...c, id: String(i) })) ?? [];
  const total = weightsTotal(rows);
  const columns = cells.map((column) => ({ ...column, header: t(`columns.${column.id}`) }));

  return (
    <div className="flex flex-wrap items-start gap-6">
      <section className="min-w-0 flex-[8_1_600px] rounded-card border border-border bg-surface shadow-1">
        <div className="flex flex-col gap-0.5 px-5 pt-5 pb-3.5">
          <h2 className="text-section">{t('competencies')}</h2>
          <p className="text-meta text-text-2">{t('intro')}</p>
        </div>
        <DataTable
          caption={t('competencies')}
          columns={columns}
          rows={rows}
          getRowId={(c) => c.id}
          emptyMessage={t('noRubric')}
          loading={state.status === 'loading'}
          loadingLabel={t('loading')}
          {...(state.status === 'error' && {
            error: { message: t('error'), retryLabel: t('retry'), onRetry: state.onRetry },
          })}
        />
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
            <StatusBadge
              status={total === 100 ? 'supported' : 'needsValidation'}
              label={t('weightsTotal', { total })}
            />
          </div>
        )}
      </section>
      {rubric && (
        <div className="flex min-w-0 flex-[4_1_320px] flex-col gap-6">
          <Card title={t('success')} level={2}>
            <p className="text-text-2">{rubric.shown?.successStatement || t('successEmpty')}</p>
          </Card>
          <Card title={t('scoring')} level={2}>
            <dl className="flex flex-col gap-3">
              {STRENGTHS.map((s) => (
                <div key={s} className="flex flex-col gap-0.5">
                  <dt>
                    <StrengthMeter strength={s} label={t(`strength.${s}`)} />
                  </dt>
                  <dd className="text-meta text-text-2">{t(`strengthMeaning.${s}`)}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title={t('approval')} level={2}>
            <ol className="flex flex-col">
              {rubric.history.map((h) => (
                <li key={h.version} className="flex flex-col gap-1 border-border py-3 first:pt-0 not-first:border-t">
                  <span className="font-semibold">
                    {t('version', { version: h.version, status: t(`status.${h.status}`) })}
                  </span>
                  {(h.approved || h.note) && (
                    <span className="text-meta text-text-2">
                      {/* Two lines on screen, one sentence when read: "Version 2, approved · Head of Engineering · …". */}
                      <span className="sr-only">{t('separator')}</span>
                      {h.approved
                        ? h.approved.by
                          ? t('approvedBy', { name: h.approved.by, date: h.approved.at })
                          : t('approvedOn', { date: h.approved.at })
                        : h.note}
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-meta text-text-2">{t('editNote')}</p>
          </Card>
        </div>
      )}
    </div>
  );
}
