'use client';

import { useTimeZone, useTranslations } from '@aivera/i18n/react';
import { Card } from '@aivera/ui';
import type { ReactNode } from 'react';
import type { WorkspaceRow } from '../domain/workspaces.ts';
import { SyntheticBadge, WorkspaceStatus } from './WorkspaceBadges.tsx';

/** One workspace's platform facts and the operator actions on it (AIV-P2-036). Never a member or candidate. */
export function WorkspaceDetail({ workspace }: { workspace: WorkspaceRow }) {
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
      <Card title={t('detail.actions')} level={2}>
        {/* shortcut: no operator action on a workspace exists yet, only access entries, so the history is always empty;
            AIV-P2-037 adds the first action (suspend) and lists the platform audit log entries here. */}
        <p className="text-body text-text-2">{t('detail.noActions')}</p>
      </Card>
    </div>
  );
}
