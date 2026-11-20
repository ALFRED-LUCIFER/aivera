'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card, Skeleton, StatusBadge } from '@credalent/ui';
import Link from 'next/link';
import type { ApprovalItem } from '../domain/desk.ts';

export type DeskState =
  { status: 'loading' } | { status: 'error'; onRetry: () => void } | { status: 'ready'; items: ApprovalItem[] };

/**
 * My desk's "Waiting on others" rubric approvals (Desk artboard, AIV-P1-014): "Rubric approval · Staff Backend
 * Engineer, version 2. With the VP Engineering.", done once the hiring owner approves. The artboard's other desk
 * items, its waiting times and the "Waiting on you" queue come with desk queues (AIV-P2-017).
 */
export function DeskApprovals({ state }: { state: DeskState }) {
  const t = useTranslations('desk');
  return (
    <Card title={t('waitingOnOthers')} level={2}>
      {state.status === 'loading' ? (
        <output aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </output>
      ) : state.status === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>{t('error')}</p>
          <Button onClick={state.onRetry}>{t('retry')}</Button>
        </div>
      ) : state.items.length === 0 ? (
        <p className="text-text-2">{t('nothingWaiting')}</p>
      ) : (
        <ul className="flex flex-col">
          {state.items.map((item) => (
            <li
              key={`${item.jobId}-${item.version}`}
              className="flex flex-wrap items-center justify-between gap-3 border-border py-3 first:pt-0 not-first:border-t"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">{t(item.done ? 'rubricApproved' : 'rubricApproval')}</span>
                <span className="text-meta text-text-2">
                  {t(item.owner ? 'approvalWith' : 'approvalOf', {
                    job: item.job,
                    version: item.version,
                    owner: item.owner ?? '',
                  })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {item.done && <StatusBadge status="supported" label={t('done')} />}
                <Link
                  href={`/app/jobs/${item.jobId}/rubric`}
                  aria-label={t('openLabel', { job: item.job })}
                  className="text-body underline underline-offset-2"
                >
                  {t('open')}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
