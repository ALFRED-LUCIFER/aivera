'use client';

import { useTranslations } from '@aivera/i18n/react';
import { Button, Card, DataTable, Label, StatusBadge, StrengthMeter, Textarea } from '@aivera/ui';
import { useId, type ReactNode } from 'react';
import { STRENGTHS, weightsTotal, type RubricEditorView, type RubricView } from '../domain/rubric.ts';
import { cells, type Row } from './RubricCells.tsx';

export type RubricState =
  { status: 'loading' } | { status: 'error'; onRetry: () => void } | { status: 'ready'; rubric: RubricView };

type Props = {
  state: RubricState;
  /** Edit mode, for admins and recruiters only (AIV-P1-013); absent for everyone else. */
  editor?: RubricEditorView | undefined;
  /** Who approves the new version, for the "sent" message. */
  hiringOwner?: string | null;
  /** The hiring owner's approval panel (AIV-P1-014), first in the side column; absent for everyone else. */
  decision?: ReactNode;
};

/**
 * The job's rubric (AIV-P1-012): agreed competencies, what success means, scoring definitions and approval history.
 * In edit mode (AIV-P1-013) weights, levels and types change locally, and competencies can be added or removed;
 * nothing changes until the recruiter saves the draft or sends it for approval.
 */
export function Rubric({ state, editor, hiringOwner = null, decision }: Props) {
  const t = useTranslations('rubric');
  const successId = useId();
  const rubric = state.status === 'ready' ? state.rubric : null;
  const editing = editor?.editing ? editor : null;
  const shown = editing?.competencies ?? rubric?.shown?.competencies ?? [];
  const rows: Row[] = shown.map((c, index) => ({ ...c, id: String(index), index, editor: editing }));
  const total = editing?.total ?? weightsTotal(rows);
  const columns = cells.map((column) => ({ ...column, header: t(`columns.${column.id}`) }));
  const message = editor && editor.status !== 'idle' && (
    <div
      role={editor.status === 'stale' || editor.status === 'failed' ? 'alert' : 'status'}
      className="mx-5 mb-5 rounded-control border border-border bg-surface-subtle px-3 py-2 text-body"
    >
      {editor.status === 'sent'
        ? hiringOwner
          ? t('edit.sent', { name: hiringOwner })
          : t('edit.sentNoOwner')
        : t(`edit.${editor.status}`)}
    </div>
  );

  return (
    <div className="flex flex-wrap items-start gap-6">
      <section className="min-w-0 flex-[8_1_600px] rounded-card border border-border bg-surface shadow-1">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3.5">
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
            <h2 className="text-section">{t('competencies')}</h2>
            <p className="text-meta text-text-2">{t('intro')}</p>
          </div>
          {editor && !editing && rubric?.edit && <Button onClick={editor.onStart}>{t('edit.start')}</Button>}
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
        {(rows.length > 0 || editing) && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
            <StatusBadge
              status={total === 100 ? 'supported' : 'needsValidation'}
              label={total === 100 ? t('weightsTotal', { total }) : t('edit.weightsWrong', { total })}
            />
            {editing && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={editing.onAdd}>{t('edit.add')}</Button>
                <Button variant="ghost" onClick={editing.onCancel}>
                  {t('edit.cancel')}
                </Button>
                <Button disabled={!editing.canSave} onClick={editing.onSave}>
                  {t('edit.save')}
                </Button>
                <Button variant="primary" disabled={!editing.canSave} onClick={editing.onSend}>
                  {t('edit.send')}
                </Button>
              </div>
            )}
          </div>
        )}
        {message}
      </section>
      {rubric && (
        <div className="flex min-w-0 flex-[4_1_320px] flex-col gap-6">
          {decision}
          <Card title={editing ? undefined : t('success')} level={2}>
            {editing ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor={successId} className="text-card">
                  {t('success')}
                </Label>
                <Textarea
                  id={successId}
                  value={editing.successStatement}
                  maxLength={2000}
                  onChange={(e) => editing.onSuccessStatement(e.target.value)}
                />
              </div>
            ) : (
              <p className="text-text-2">{rubric.shown?.successStatement || t('successEmpty')}</p>
            )}
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
                  {h.returnNote && (
                    <span className="text-meta text-text-2">{t('returnNote', { note: h.returnNote })}</span>
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
