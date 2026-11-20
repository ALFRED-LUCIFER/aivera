'use client';

import { PLATFORM_ACTIONS, type PlatformAction } from '@aivera/audit';
import type { Messages } from '@aivera/i18n';
import { useTranslations } from '@aivera/i18n/react';
import { Button, buttonClassName, DataTable, Input, Label, Select, type DataTableColumn } from '@aivera/ui';
import type { Route } from 'next';
import Form from 'next/form';
import Link from 'next/link';
import { auditQuery, utcMinute, type AuditLogView, type AuditRow } from '../domain/audit.ts';
import { workspaceHref } from '../domain/workspaces.ts';

type ColumnId = keyof Messages['ops']['audit']['columns'];
type ValueKey = keyof Messages['ops']['audit']['values'];
type StatusKey = keyof Messages['ops']['workspaces']['status'];
type Value = string | number | boolean | null | undefined;

const cells: (Omit<DataTableColumn<AuditRow>, 'header'> & { id: ColumnId })[] = [
  { id: 'time', cell: (row) => <TimeCell row={row} /> },
  { id: 'operator', cell: (row) => <OperatorCell row={row} /> },
  { id: 'action', cell: (row) => <ActionName action={row.action} /> },
  { id: 'target', cell: (row) => <TargetCell row={row} /> },
  { id: 'reason', cell: (row) => <ReasonCell row={row} /> },
  { id: 'change', cell: (row) => <ChangeCell row={row} /> },
];

const field = 'flex min-w-44 flex-col gap-1.5';

/**
 * The platform audit log (AIV-P2-054, ADR-012 point 8): who did what, to which record and why, newest first, 50 a page.
 * Filters are a GET form, so the URL holds only an action key, opaque ids and UTC days (AGENTS.md 1.2). Operators show by
 * display name; never an email and never candidate data.
 * Deviations from the console spec: no previous-page button and no "Page 1 of 3", because the log pages by the last
 * entry (keyset) and has no page count; the browser's back button returns to the previous page.
 */
export function AuditLog({ filters, table }: AuditLogView) {
  const t = useTranslations('ops.audit');
  const columns = cells.map((column) => ({ ...column, header: t(`columns.${column.id}`) }));
  const ready = table.status === 'ready' ? table : null;

  return (
    <div className="flex flex-col gap-4">
      {filters && (
        <search>
          <Form
            action="/ops/audit"
            aria-label={t('filters')}
            // Uncontrolled fields: a new URL starts a new form with its values.
            key={auditQuery(filters.params)}
            className="flex flex-wrap items-end gap-3"
          >
            <div className={field}>
              <Label htmlFor="ops-audit-action">{t('action')}</Label>
              <Select id="ops-audit-action" name="action" defaultValue={filters.params.action ?? ''}>
                <option value="">{t('anyAction')}</option>
                {PLATFORM_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {t(`actionNames.${action}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className={field}>
              <Label htmlFor="ops-audit-actor">{t('operator')}</Label>
              <Select id="ops-audit-actor" name="actor" defaultValue={filters.params.actor ?? ''}>
                <option value="">{t('anyOperator')}</option>
                {filters.operators.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
            <div className={field}>
              <Label htmlFor="ops-audit-target">{t('target')}</Label>
              <Input
                id="ops-audit-target"
                name="target"
                maxLength={36}
                spellCheck={false}
                autoComplete="off"
                // The browser submits an opaque id only, so typed text never reaches the URL.
                pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                title={t('targetHint')}
                aria-describedby="ops-audit-target-hint"
                defaultValue={filters.params.target ?? ''}
              />
              <p id="ops-audit-target-hint" className="text-meta text-text-2">
                {t('targetHint')}
              </p>
            </div>
            <div className={field}>
              <Label htmlFor="ops-audit-from">{t('from')}</Label>
              <Input id="ops-audit-from" name="from" type="date" defaultValue={filters.params.from ?? ''} />
            </div>
            <div className={field}>
              <Label htmlFor="ops-audit-to">{t('to')}</Label>
              <Input id="ops-audit-to" name="to" type="date" defaultValue={filters.params.to ?? ''} />
            </div>
            <span className="flex gap-2">
              <Button type="submit" variant="primary">
                {t('apply')}
              </Button>
              <Link href="/ops/audit" className={buttonClassName('secondary')}>
                {t('clear')}
              </Link>
            </span>
          </Form>
        </search>
      )}
      <DataTable
        caption={t('caption')}
        columns={columns}
        rows={ready?.rows ?? []}
        getRowId={(row) => row.id}
        emptyMessage={ready?.filtered ? t('noMatch') : t('empty')}
        loading={table.status === 'loading'}
        loadingLabel={t('loading')}
        {...(table.status === 'error' && {
          error: { message: t('error'), retryLabel: t('retry'), onRetry: table.onRetry },
        })}
        footer={
          ready?.nextHref && (
            <Link href={ready.nextHref as Route} className={`${buttonClassName('secondary', 'compact')} ms-auto`}>
              {t('next')}
            </Link>
          )
        }
      />
    </div>
  );
}

function ActionName({ action }: { action: PlatformAction }) {
  const t = useTranslations('ops.audit');
  return <span className="whitespace-nowrap">{t(`actionNames.${action}`)}</span>;
}

function TimeCell({ row }: { row: AuditRow }) {
  const t = useTranslations('ops.audit');
  return <span className="whitespace-nowrap">{t('time', { time: utcMinute(row.occurredAt) })}</span>;
}

function OperatorCell({ row }: { row: AuditRow }) {
  const t = useTranslations('ops.audit');
  return row.operatorName ?? <span className="text-text-2">{t('noName')}</span>;
}

function TargetCell({ row }: { row: AuditRow }) {
  const t = useTranslations('ops.audit');
  if (!row.subject) return <span className="text-text-2">{t('none')}</span>;
  if (row.subject.type !== 'workspace') return <span className="font-mono text-meta">{row.subject.id}</span>;
  return (
    // No prefetch: opening a workspace is recorded on the server (ADR-012), so only a real visit may render it.
    <Link
      href={workspaceHref(row.subject.id)}
      prefetch={false}
      className="font-mono text-meta text-text underline underline-offset-2 hover:text-text-2"
    >
      {t('workspace', { id: row.subject.id })}
    </Link>
  );
}

function ReasonCell({ row }: { row: AuditRow }) {
  const t = useTranslations('ops.audit');
  return row.note ?? <span className="text-text-2">{t('none')}</span>;
}

function ChangeCell({ row }: { row: AuditRow }) {
  const t = useTranslations('ops.audit');
  const ts = useTranslations('ops.workspaces.status');
  const keys = [...new Set([...Object.keys(row.before ?? {}), ...Object.keys(row.after ?? {})])];
  if (keys.length === 0) return <span className="text-text-2">{t('none')}</span>;
  const show = (key: string, value: Value) => {
    if (value === null || value === undefined) return t('none');
    if (typeof value === 'boolean') return t(value ? 'values.on' : 'values.off');
    if (typeof value === 'number') return t('values.count', { count: value });
    return key === 'status' && ts.has(value as StatusKey) ? ts(value as StatusKey) : value;
  };
  return (
    <ul className="flex flex-col gap-0.5">
      {keys.map((key) => (
        <li key={key} className="whitespace-nowrap">
          {t('change', {
            field: t.has(`values.${key}` as `values.${ValueKey}`) ? t(`values.${key}` as `values.${ValueKey}`) : key,
            before: show(key, row.before?.[key]),
            after: show(key, row.after?.[key]),
          })}
        </li>
      ))}
    </ul>
  );
}
