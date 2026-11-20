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
  const count = useTranslations('ops.workspaces');
  const observed = <ValueBasis basis="observed" label={t('observed')} />;
  const columns = [
    { id: 'day', header: t('day'), cell: (row: Day) => row.day },
    { id: 'tokens', header: t('tokens'), numeric: true, cell: (row: Day) => count('count', { count: row.tokens }) },
    { id: 'basis', header: t('basis'), cell: () => observed },
  ];

  return (
    <Card title={t('title')} level={2}>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
        <div className="contents">
          <dt className="text-meta font-semibold text-text-2">{t('today')}</dt>
          <dd className="flex flex-wrap items-center gap-2 text-body text-text tabular-nums">
            {ai ? (
              <>
                {t('todayValue', { used: ai.days[0]?.tokens ?? 0, budget: ai.dailyBudget })}
                {observed}
                <UsageBar used={ai.days[0]?.tokens ?? 0} budget={ai.dailyBudget} />
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

/**
 * Today's share of the daily budget as a neutral ink bar (the text beside it carries the value, so it is hidden from
 * assistive tech). Ink, not a status colour: being near the budget is a fact, not a fault.
 */
function UsageBar({ used, budget }: { used: number; budget: number }) {
  const share = budget > 0 ? Math.min(1, used / budget) : 0;
  return (
    <span aria-hidden="true" className="block h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface-subtle">
      <span
        className="block h-full rounded-full bg-text"
        style={{ width: `${Math.max(share * 100, used > 0 ? 1 : 0)}%` }}
      />
    </span>
  );
}
