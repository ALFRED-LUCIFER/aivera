'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card, ScoreWithUncertainty, Skeleton, ValueBasis, buttonClassName } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { evidenceAnchor, profileHref } from '@/features/evidence-profile/domain/profile.ts';
import { MAX_COMPARE, MIN_COMPARE, compareHref } from '@/features/compare/domain/compare.ts';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import { packHref } from '@/features/ranking/domain/pack.ts';
import type { DecisionPackView, PackPage, RecordView } from '../domain/pack.ts';
import { Needs, SummaryText } from './CardSummary.tsx';
import { DecisionChoice, RecordSection } from './RecordDecisions.tsx';

// AIV-P2-010, AIV-P2-011: the decision pack, from the Pack artboard (docs/01-design/artboards/Pack.dc.html). Ported:
// the pack's name, "prepared <date> · rubric vN", "What the job needs" and "Competencies and weights", one card per
// member with their backed score and claim range (as snapshotted when they joined), "Strengths, backed", "Outstanding
// risks", "Round 1 finding" and "Credalent's recommendation", "Back to ranking", and "Shared packs show evidence
// summaries and sources, not raw files. N other candidates stay in the ranking and can be added to a later pack.".
// Added beyond the artboard: "Added by <who added them> on <date>" under each member (AIV-P1-139); the basis "Observed"
// (AGENTS.md 1.7); under each statement the excerpt it quotes, highlighted as cited evidence, or for the candidate's
// own words (a CV) under the shared "Claim" tag and never highlighted (AGENTS.md 1.6), with its source linked to the
// item on the candidate's profile, or "Source: the assessment" (the ticket: every sentence links to its evidence); "Preparing
// summary" while the worker writes a card, and "Summary unavailable" with the assessment's own strengths when no
// answer with valid citations came; and the empty pack's line. Credalent's recommendation is advice: the pack summary
// moves no stage; recorded decisions do, AIV-P2-012 (AGENTS.md 1.5).
// Deviations:
// - the name is an h2 under the shared job header, whose h1 is the job and whose breadcrumb is Jobs / job (AIV-P1-011),
//   and each member's name an h3;
// - the subtitle leaves out "for the Head of Engineering": the hiring owner's job title is not stored;
// - "What the role needs" reads "What the job needs": the copy rules never call a job a role (packages/i18n copy test);
// - the card's sentences are the model's (decisions.summariseMember), cited and checked in code, so they word things
//   their own way rather than as the artboard's examples;
// - the Round 1 finding is what the interview notes say, with no score change ("rose from 58 to 68"): the card reads
//   only the snapshot the member joined with, not an earlier one to compare it with;
// - the recommendation reads "advance" or "hold" (decided in code from the snapshot), then "and look into <focus> next"
//   with the gap the model names ("Product judgement"), not "probe cost in Round 2"; "hold" is not on the artboard,
//   which only shows advance (Credalent never recommends rejecting: AGENTS.md 1.6);
// - the decision choices and "Record the decision" (AIV-P2-012) are in RecordDecisions.tsx, with their deviations;
// - "Open comparison" shows for a pack of 2 to 10 candidates, what one comparison holds (AIV-P1-047);
// - "Preview the client view" reads "Preview as the hiring owner sees it" (AIV-P1-116's wording) and opens the branded
//   preview inside Credalent; sharing it is AIV-P2-013 (#127);
// - the cards' padding is the shared Card's 16 px, not 24 px;
// - no "Decision packs" sidebar count: that item waits behind its flag for the packs list (AIV-P2-E02, #19);
// - no Credalent assistant panel: the assistant is AIV-P2-028 (#142).

/** `record`: the hiring owner's choices and "Record decisions" (AIV-P2-012); without it the choices are read-only. */
export function DecisionPack({ view, record }: { view: DecisionPackView; record?: RecordView }) {
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
  return <Pack pack={view.pack} record={record} />;
}

function Pack({ pack, record }: { pack: PackPage; record: RecordView | undefined }) {
  const t = useTranslations();
  const names = new Map(pack.members.map((m) => [m.candidateId, m.name ?? t('ranking.unnamed')] as const));
  // Read-only once recorded, before the page is read again too, and for anyone but the job's hiring owner.
  const readOnly = pack.decided !== null || !pack.mayDecide || Boolean(record?.recordedAt);
  return (
    <section aria-labelledby="pack-title" className="flex flex-col gap-4 self-stretch">
      <div className="flex flex-wrap items-end justify-between gap-3">
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
        {/* packHref and compareHref build their paths from opaque ids, which typed routes cannot check. */}
        <div className="flex flex-wrap gap-2">
          {pack.members.length >= MIN_COMPARE && pack.members.length <= MAX_COMPARE && (
            <Link
              href={
                compareHref(
                  pack.jobId,
                  pack.members.map((m) => m.candidateId),
                ) as Route
              }
              className={buttonClassName('secondary')}
            >
              {t('decisionPack.openComparison')}
            </Link>
          )}
          <Link href={`${packHref(pack.jobId, pack.packId)}/preview` as Route} className={buttonClassName('secondary')}>
            {t('decisionPack.openPreview')}
          </Link>
        </div>
      </div>
      {pack.role && (
        <Card>
          <div className="flex flex-wrap gap-x-10 gap-y-5">
            <div className="flex min-w-0 flex-[2_1_380px] flex-col gap-2">
              <h3 className="text-section text-text">{t('decisionPack.role.needs')}</h3>
              <p className="text-body text-text-2">{pack.role.successStatement}</p>
            </div>
            <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2">
              <h3 className="text-section text-text">{t('decisionPack.role.weights')}</h3>
              <p className="text-meta text-text-2 tabular-nums">
                {pack.role.competencies
                  .map((c) => t('decisionPack.role.weight', { name: c.name, weight: c.weightPercent }))
                  .join(' · ')}
              </p>
            </div>
          </div>
        </Card>
      )}
      {pack.members.length === 0 ? (
        <p className="text-body text-text">{t('decisionPack.empty')}</p>
      ) : (
        pack.members.map((m) => (
          <Member key={m.candidateId} jobId={pack.jobId} member={m}>
            <DecisionChoice member={m} name={names.get(m.candidateId) ?? ''} record={record} readOnly={readOnly} />
          </Member>
        ))
      )}
      {pack.members.length > 0 && <RecordSection pack={pack} record={record} names={names} />}
      <p className="flex flex-wrap items-center gap-2 text-meta text-text-2">
        <ValueBasis basis="observed" label={t('ranking.observed')} />
        {t('decisionPack.basis')}
      </p>
      <p className="text-meta text-text-2">
        {t('decisionPack.shared')} {t('decisionPack.others', { count: pack.others })}
      </p>
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

function Member({
  jobId,
  member: m,
  children,
}: {
  jobId: string;
  member: PackPage['members'][number];
  children: ReactNode;
}) {
  const t = useTranslations();
  const titleId = `member-${m.candidateId}`;
  const profile = profileHref(m.candidateId, jobId);
  return (
    <section aria-labelledby={titleId}>
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <span className="flex flex-[1_1_200px] flex-col">
              <h3 id={titleId} className="text-section text-text">
                {/* profileHref builds the path from opaque ids, which typed routes cannot check. */}
                <Link href={profile as Route} className="underline-offset-2 hover:underline">
                  {m.name ?? t('ranking.unnamed')}
                </Link>
              </h3>
              {m.added && (
                <span className="text-meta text-text-2">
                  {t('decisionPack.addedBy', { name: m.added.by, date: m.added.at })}
                </span>
              )}
            </span>
            <span className="max-w-80 min-w-60 flex-[1_1_240px]">
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
          </div>
          {m.summary.status === 'ready' ? (
            <SummaryText
              summary={m.summary.summary}
              labels={{ strengths: t('decisionPack.summary.strengths'), risks: t('decisionPack.summary.risks') }}
              hrefFor={(itemId) => `${profile}#${evidenceAnchor(itemId)}`}
            />
          ) : m.summary.status === 'preparing' ? (
            <output className="block text-body text-text-2">{t('decisionPack.summary.preparing')}</output>
          ) : (
            <>
              <p className="text-body text-text-2">{t('decisionPack.summary.unavailable')}</p>
              <Needs
                title={t('decisionPack.summary.strengths')}
                rows={m.summary.strengths}
                empty={t('decisionPack.preview.noStrengths')}
              />
            </>
          )}
          {children}
        </div>
      </Card>
    </section>
  );
}
