'use client';

import { useTranslations } from '@credalent/i18n/react';
import type { Route } from 'next';
import Link from 'next/link';
import { packHref } from '@/features/ranking/domain/pack.ts';
import type { PackLink } from '../domain/pack.ts';

/** The job's Decision tab (AIV-P2-010): its undecided packs, each opening its page, or why there is none yet. */
export function PackList({ jobId, packs }: { jobId: string; packs: PackLink[] }) {
  const t = useTranslations();
  if (packs.length === 0) return <p className="text-body text-text-2">{t('jobHeader.empty.pack')}</p>;
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
