'use client';

import { useTranslations } from '@credalent/i18n/react';
import { StatTile } from '@credalent/ui';
import Link from 'next/link';
import { AI_SORTED_HREF, STATUS_TILES, statusHref, type DashboardView } from '../domain/dashboard.ts';
import { EvalStatusBadge } from './CatalogueEval.tsx';

const link = 'text-text underline underline-offset-2';

/**
 * The console home's stat tiles (AIV-P2-051): workspaces by status, AI tokens today against budgets and the catalogue
 * version with its waiting draft and eval state, each with its basis marker and a link to act. Platform counts only, never a name or candidate value; a
 * failed read shows its error in its own tile and the others still show.
 * Deviations from operator-console.md Home: no "Needs an operator" rows and no approval-mode tile (not in the ticket);
 * a failed tile's "Try again" is a link to /ops,
 * not the States table's button: the page is a server render, so reloading it re-runs the reads with no client code.
 */
export function OpsDashboard({ statuses, oldestWaitingDays, ai, catalogue }: DashboardView) {
  const t = useTranslations('ops');
  const basis = {
    basis: 'observed',
    basisLabel: t('home.observed'),
    notAvailableLabel: t('home.notAvailable'),
  } as const;
  const retry = (
    <Link href="/ops" className={link}>
      {t('home.retry')}
    </Link>
  );
  return (
    <section aria-labelledby="ops-tiles" className="flex flex-col gap-3">
      <h2 id="ops-tiles" className="text-card text-text">
        {t('home.tiles')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STATUS_TILES.map((status) => {
          const count = statuses?.find((s) => s.status === status)?.count ?? 0;
          return (
            <StatTile
              key={status}
              label={t(`workspaces.status.${status}`)}
              value={t('home.count', { count })}
              {...basis}
              {...(statuses === null && { error: t('home.workspacesError') })}
              detail={
                status === 'pending_approval' &&
                oldestWaitingDays !== null &&
                t('home.oldest', { days: oldestWaitingDays })
              }
              action={
                statuses === null ? (
                  retry
                ) : (
                  <Link href={statusHref(status)} className={link}>
                    {t(`home.view.${status}`)}
                  </Link>
                )
              }
            />
          );
        })}
        <StatTile
          label={t('home.ai.label')}
          value={ai && ai.tokens !== null ? t('home.count', { count: ai.tokens }) : null}
          {...basis}
          {...(ai === null && { error: t('home.ai.error') })}
          detail={ai && ai.tokens !== null && t('home.ai.budgets', { near: ai.nearBudget, at: ai.atBudget })}
          action={
            ai === null ? (
              retry
            ) : (
              <Link href={AI_SORTED_HREF} className={link}>
                {t('home.ai.view')}
              </Link>
            )
          }
        />
        <StatTile
          label={t('home.catalogue.label')}
          value={catalogue && t('home.count', { count: catalogue.version })}
          {...basis}
          {...(catalogue === null && { error: t('home.catalogue.error') })}
          detail={
            catalogue && (
              <>
                {[
                  t('home.catalogue.live', { version: catalogue.version }),
                  ...(catalogue.draft
                    ? [
                        t('home.catalogue.draft'),
                        t(`home.catalogue.edited.${catalogue.draft.edited.unit}`, {
                          count: catalogue.draft.edited.count,
                        }),
                      ]
                    : [t('home.catalogue.noDraft')]),
                ].join(' · ')}
                {catalogue.draft && (
                  <span className="ms-2 inline-flex align-middle">
                    <EvalStatusBadge status={catalogue.draft.eval} />
                  </span>
                )}
              </>
            )
          }
          action={
            catalogue === null ? (
              retry
            ) : (
              <Link href="/ops/catalogue" className={link}>
                {t('home.catalogue.view')}
              </Link>
            )
          }
        />
      </div>
    </section>
  );
}
