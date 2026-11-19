'use client';

import { useTranslations } from '@aivera/i18n/react';
import { Card, DataTable, ValueBasis } from '@aivera/ui';
import type { ReactNode } from 'react';
import type { WorkspaceRow } from '../domain/workspaces.ts';

type Day = { day: string; tokens: number };

/**
 * A workspace's AI token use (AIV-P2-038): today against its daily budget, and the last 7 UTC days, each observed.
 * `ai` null: the usage store could not be read, so it reads "Not yet available" (AGENTS.md 1.7). `children`: the form.
 */
export function AiTokenUse({ ai, children }: { ai: WorkspaceRow['ai']; children?: ReactNode }) {
  const t = useTranslations('ops.workspaces.ai');
  const observed = <ValueBasis basis="observed" label={t('observed')} />;
  const columns = [
    { id: 'day', header: t('day'), cell: (row: Day) => row.day },
    { id: 'tokens', header: t('tokens'), numeric: true, cell: (row: Day) => t('count', { count: row.tokens }) },
    { id: 'basis', header: t('basis'), cell: () => observed },
  ];

  return (
    <Card title={t('title')} level={2}>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
        <div className="contents">
          <dt className="text-meta font-semibold text-text-2">{t('today')}</dt>
          <dd className="flex flex-wrap items-center gap-2 text-body text-text">
            {ai ? (
              <>
                {t('todayValue', { used: ai.days[0]?.tokens ?? 0, budget: ai.dailyBudget })}
                {observed}
              </>
            ) : (
              <>
                {t('notAvailable')}
                <ValueBasis basis="not-available" label={t('notAvailable')} />
              </>
            )}
          </dd>
        </div>
        {ai && (
          <div className="contents">
            <dt className="text-meta font-semibold text-text-2">{t('budget')}</dt>
            <dd className="text-body text-text">
              {t(ai.overridden ? 'budgetOverride' : 'budgetDefault', { budget: ai.dailyBudget })}
            </dd>
          </div>
        )}
      </dl>
      {ai && (
        <DataTable
          className="mt-4"
          caption={t('days')}
          columns={columns}
          rows={ai.days}
          getRowId={(row) => row.day}
          emptyMessage={t('notAvailable')}
        />
      )}
      {children}
    </Card>
  );
}
