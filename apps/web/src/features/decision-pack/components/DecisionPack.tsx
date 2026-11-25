'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, ScoreWithUncertainty, Skeleton, ValueBasis, buttonClassName } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { profileHref } from '@/features/evidence-profile/domain/profile.ts';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import type { DecisionPackView, PackPage } from '../domain/pack.ts';

// AIV-P2-010: the decision pack a recruiter built from the ranking, from the Pack artboard
// (docs/01-design/artboards/Pack.dc.html). Ported: the pack's name, "prepared <date> · rubric vN", each member with
// their backed score and claim range (as snapshotted when they joined) and the basis "Observed" (AGENTS.md 1.7),
// "Back to ranking", and "N other candidates stay in the ranking and can be added to a later pack.". Added beyond the
// artboard (AIV-P1-139): "Added by <who added them> on <date>" under each member, so the hiring owner sees who put a
// candidate in front of them.
// Deviations:
// - the name is an h2 under the shared job header, whose h1 is the job and whose breadcrumb is Jobs / job (AIV-P1-011);
// - the subtitle leaves out "for the Head of Engineering": the hiring owner's job title is not stored;
// - no "What the role needs", strengths, risks, Round 1 findings, Credalent's recommendation, "Record decisions" or the
//   decision emails: the pack's content and the hiring owner's decisions are AIV-P2-011 (#125);
// - no "Open comparison" (AIV-P1-047, #111) and no "Preview the client view" or "Shared packs show summaries…" note
//   (AIV-P2-013, #127);
// - the job header's Decision stage line stays "Not started" until packs report there (AIV-P2-011, #125);
// - no "Decision packs" sidebar count: that item waits behind its flag for the packs list (AIV-P2-E02, #19);
// - no Credalent assistant panel: the assistant is AIV-P2-028 (#142).

export function DecisionPack({ view }: { view: DecisionPackView }) {
  const t = useTranslations();
  if (view.status === 'loading')
    return (
      <div className="flex flex-col gap-3 self-stretch" aria-busy="true">
        <span className="sr-only">{t('decisionPack.loading')}</span>
        <Skeleton className="h-7 w-80" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (view.status === 'error')
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-body text-text">{t('decisionPack.error')}</p>
        <Button onClick={view.onRetry}>{t('ranking.retry')}</Button>
      </div>
    );
  return <Pack pack={view.pack} />;
}

function Pack({ pack }: { pack: PackPage }) {
  const t = useTranslations();
  return (
    <section aria-labelledby="pack-title" className="flex flex-col gap-3 self-stretch">
      <div>
        <h2 id="pack-title" className="text-card text-text">
          {t('decisionPack.title', { name: pack.name, job: pack.job })}
        </h2>
        <p className="text-meta text-text-2">
          {pack.rubricVersion === null
            ? t('decisionPack.prepared', { date: pack.preparedAt })
            : t('decisionPack.preparedOn', { date: pack.preparedAt, version: pack.rubricVersion })}
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-surface">
        {pack.members.map((m) => (
          <li key={m.candidateId} className="flex flex-wrap items-center justify-between gap-3 p-3">
            {/* profileHref builds the path from opaque ids, which typed routes cannot check. */}
            <span className="flex flex-col">
              <Link
                href={profileHref(m.candidateId, pack.jobId) as Route}
                className="font-semibold text-text underline-offset-2 hover:underline"
              >
                {m.name ?? t('ranking.unnamed')}
              </Link>
              {m.added && (
                <span className="text-meta text-text-2">
                  {t('decisionPack.addedBy', { name: m.added.by, date: m.added.at })}
                </span>
              )}
            </span>
            <span className="min-w-44">
              <ScoreWithUncertainty
                compact
                backed={m.backedScore}
                upTo={m.upperBound}
                backedLabel={(backed) => t('score.backed', { backed })}
                captionLabel={(backed, upTo) => t('score.backedUpToCompact', { backed, upTo })}
                upToLabel={(upTo) => t('score.upToCompact', { upTo })}
                unavailableLabel={t('score.unavailable')}
              />
            </span>
          </li>
        ))}
      </ul>
      <p className="flex flex-wrap items-center gap-2 text-meta text-text-2">
        <ValueBasis basis="observed" label={t('ranking.observed')} />
        {t('decisionPack.basis')}
      </p>
      <p className="text-meta text-text-2">{t('decisionPack.others', { count: pack.others })}</p>
      {/* jobPageHref builds the path from the job id, which typed routes cannot check. */}
      <Link
        href={jobPageHref(pack.jobId, 'candidates') as Route}
        className={`self-start ${buttonClassName('secondary')}`}
      >
        {t('decisionPack.back')}
      </Link>
    </section>
  );
}
