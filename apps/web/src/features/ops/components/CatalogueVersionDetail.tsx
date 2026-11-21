'use client';

import type { CatalogueChange } from '@credalent/jobs';
import { useTimeZone, useTranslations } from '@credalent/i18n/react';
import { Card } from '@credalent/ui';
import type { ReactNode } from 'react';
import type { VersionRow } from '../domain/catalogueHistory.ts';
import { CatalogueDiff } from './CatalogueDiff.tsx';
import { Changes, EvalBadge, Publisher } from './CatalogueVersions.tsx';

/*
 * One published catalogue version, read-only (AIV-P2-050): who published it, when and why, its changes against the
 * version before, and its entries (the page passes the read-only Catalogue as children). No artboard; the facts follow
 * the console spec's "Platform facts" list (operator-console.md). No edit controls: a published version never changes.
 */
export function CatalogueVersionDetail({
  summary,
  changes,
  children,
}: {
  summary: VersionRow;
  changes: readonly CatalogueChange[] | null;
  children: ReactNode;
}) {
  const t = useTranslations('ops.catalogue.history');
  const timeZone = useTimeZone();
  const facts: [string, ReactNode][] = [
    [t('columns.publishedAt', { timeZone }), t('publishedAt', { at: summary.publishedAt })],
    [t('columns.publishedBy'), <Publisher key="by" row={summary} />],
    [t('columns.reason'), summary.reason],
    [t('columns.changes'), <Changes key="changes" row={summary} />],
    [t('columns.eval'), <EvalBadge key="eval" row={summary} />],
  ];
  return (
    <div className="flex flex-col gap-6">
      <Card title={t('facts')} level={2}>
        <dl className="divide-y divide-border">
          {facts.map(([term, value]) => (
            <div key={term} className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-2">
              <dt className="text-meta font-semibold text-text-2">{term}</dt>
              <dd className="text-body text-text">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title={changes ? t('changesAgainst', { version: summary.version - 1 }) : t('changesTitle')} level={2}>
        {changes ? <CatalogueDiff changes={changes} /> : <p className="text-body text-text">{t('firstBody')}</p>}
      </Card>
      {children}
    </div>
  );
}
