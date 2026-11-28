'use client';

import { useTranslations } from '@credalent/i18n/react';
import { buttonClassName } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import { packHref } from '@/features/ranking/domain/pack.ts';
import type { PackLink } from '../domain/pack.ts';

/** The job's Decision tab (AIV-P2-010): its undecided packs, each opening its page, or why there is none yet. */
export function PackList({ jobId, packs }: { jobId: string; packs: PackLink[] }) {
  const t = useTranslations();
  if (packs.length === 0)
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body text-text-2">{t('decisionPack.none')}</p>
        {/* jobPageHref builds the path from the job id, which typed routes cannot check. */}
        <Link href={jobPageHref(jobId, 'candidates') as Route} className={buttonClassName('primary')}>
          {t('decisionPack.toRanking')}
        </Link>
      </div>
    );
  return (
    <ul aria-label={t('decisionPack.list')} className="flex flex-col gap-2">
      {packs.map((p) => (
        <li key={p.id}>
          {/* packHref builds the path from opaque ids, which typed routes cannot check. */}
          <Link href={packHref(jobId, p.id) as Route} className="font-semibold text-text underline underline-offset-3">
            {p.name}
          </Link>{' '}
          <span className="text-meta text-text-2">{t('decisionPack.members', { count: p.members })}</span>
        </li>
      ))}
    </ul>
  );
}
