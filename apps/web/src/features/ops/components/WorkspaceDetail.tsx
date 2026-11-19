'use client';

import { useTimeZone, useTranslations } from '@aivera/i18n/react';
import { Card } from '@aivera/ui';
import type { ReactNode } from 'react';
import type { OperatorActionRow, WorkspaceRow } from '../domain/workspaces.ts';
import { SyntheticBadge, WorkspaceStatus } from './WorkspaceBadges.tsx';

/**
 * One workspace's platform facts, the operator actions taken on it with their reasons, and the status change
 * (`statusChange`, AIV-P2-037). Never a member or candidate. `children` goes between the facts and the actions: the AI
 * token use card (AIV-P2-038).
 */
export function WorkspaceDetail({
  workspace,
  history,
  statusChange,
  children,
}: {
  workspace: WorkspaceRow;
  history: OperatorActionRow[];
  statusChange: ReactNode;
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
    <div className="flex flex-col gap-4">
      {workspace.synthetic && (
        <div>
          <SyntheticBadge />
        </div>
      )}
      <Card title={t('detail.facts')} level={2}>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
          {facts.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-meta font-semibold text-text-2">{term}</dt>
              <dd className="text-body text-text">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {children}
      <Card title={t('detail.actions')} level={2}>
        <div className="flex flex-col gap-4">
          {history.length === 0 ? (
            <p className="text-body text-text-2">{t('detail.noActions')}</p>
          ) : (
            <ol className="flex flex-col gap-2 text-body text-text">
              {history.map((entry) => (
                <li key={`${entry.action} ${entry.occurredAt.toISOString()}`}>
                  {t('detail.history', {
                    action: t(`detail.actionNames.${entry.action}`),
                    date: entry.occurredAt,
                    timeZone,
                    reason: entry.reason ?? '',
                  })}
                </li>
              ))}
            </ol>
          )}
          {statusChange}
        </div>
      </Card>
    </div>
  );
}
