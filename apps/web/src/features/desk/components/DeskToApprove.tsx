'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Card, StatusBadge } from '@credalent/ui';
import Link from 'next/link';
import type { ToApproveItem } from '../domain/desk.ts';

/**
 * My desk's "Rubrics to approve" (AIV-P1-084, ADR-014): each job whose open draft or returned rubric waits for the
 * recruiter's own approval, linking to its rubric page. No artboard draws it; it follows the Desk artboard's
 * "Waiting on others" card (DeskApprovals). Loading and error states are that card's, shown before the role is known.
 */
export function DeskToApprove({ items }: { items: ToApproveItem[] }) {
  const t = useTranslations('desk');
  return (
    <Card title={t('toApprove')} level={2}>
      {items.length === 0 ? (
        <p className="text-text-2">{t('nothingToApprove')}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li
              key={`${item.jobId}-${item.version}`}
              className="flex flex-wrap items-center justify-between gap-3 border-border py-3 first:pt-0 not-first:border-t"
            >
              <span className="min-w-0 font-semibold">{t('approvalOf', { job: item.job, version: item.version })}</span>
              <div className="flex items-center gap-3">
                {item.returned && <StatusBadge status="needsValidation" label={t('returned')} />}
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
