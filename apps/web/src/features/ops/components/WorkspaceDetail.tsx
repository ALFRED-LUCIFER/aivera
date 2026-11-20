'use client';

import { useTimeZone, useTranslations } from '@aivera/i18n/react';
import { Card } from '@aivera/ui';
import type { ReactNode } from 'react';
import type { OperatorActionRow, WorkspaceRow } from '../domain/workspaces.ts';
import { WorkspaceStatus } from './WorkspaceBadges.tsx';

/**
 * One workspace's page body (AIV-P2-036, laid out in the console design pass): the AI token use card (`children`,
 * AIV-P2-038) as the main column, and beside it the platform facts and the operator actions taken on it with their
 * reasons, newest first, as a timeline. The status change (`statusChange`, AIV-P2-037) sits in the page header. Never a
 * member or candidate.
 */
export function WorkspaceDetail({
  workspace,
  history,
  children,
}: {
  workspace: WorkspaceRow;
  history: OperatorActionRow[];
  children?: ReactNode;
}) {
  const t = useTranslations('ops.workspaces');
  const timeZone = useTimeZone();
  const facts: [string, ReactNode][] = [
    [t('columns.type'), t(`type.${workspace.type}`)],
    [t('columns.created', { timeZone }), t('createdOn', { value: workspace.createdAt })],
    [t('columns.members'), t('count', { count: workspace.activeMembers })],
    [t('columns.jobs'), t('count', { count: workspace.jobs })],
    [t('columns.status'), <WorkspaceStatus key="status" status={workspace.status} />],
    [t('columns.plan'), t('noPlan')],
  ];

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      <aside className="flex flex-col gap-4">
        <Card title={t('detail.facts')} level={2}>
          <dl className="flex flex-col divide-y divide-border">
            {facts.map(([term, value]) => (
              <div key={term} className="flex min-h-10 items-center justify-between gap-4 py-2">
                <dt className="text-meta text-text-2">{term}</dt>
                <dd className="text-end text-body font-medium text-text tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title={t('detail.actions')} level={2}>
          {history.length === 0 ? (
            <p className="text-body text-text-2">{t('detail.noActions')}</p>
          ) : (
            <ol className="flex flex-col">
              {history.map((entry) => {
                const when = { action: t(`detail.actionNames.${entry.action}`), date: entry.occurredAt, timeZone };
                return (
                  <li
                    key={`${entry.action} ${entry.occurredAt.toISOString()}`}
                    className="relative border-s border-border-strong ps-4 pb-4 text-body text-text last:border-transparent last:pb-0"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute -start-[5px] top-1.5 size-2.25 rounded-full border-2 border-surface bg-text"
                    />
                    {entry.reason
                      ? t('detail.history', { ...when, reason: entry.reason })
                      : t('detail.historyNoReason', when)}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </aside>
    </div>
  );
}
