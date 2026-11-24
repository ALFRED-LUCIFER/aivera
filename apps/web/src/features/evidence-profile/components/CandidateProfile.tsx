'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card, EvidenceHighlight, ScoreWithUncertainty, ValueBasis } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import { evidenceAnchor, type Fit, type ProfileData } from '../domain/profile.ts';
import { EvidenceCards } from './EvidenceCards.tsx';

// AIV-P1-043: the top of the candidate evidence profile, from the Candidate artboard
// (docs/01-design/artboards/Candidate.dc.html): breadcrumb, name, subtitle, the fit block and "Why she is ranked here".
// "Competency by competency" under it is EvidenceCards (AIV-P1-045), with its own deviations.
// Deviations, each for a later ticket or a rule:
// - no "Compare" button: the comparison page is AIV-P1-047 (#111), and a link to nothing is not shipped;
// - no "Request evidence" button, preview card or "sent" note: the drafted preview is AIV-P1-038 (#102) and sending is
//   AIV-P1-039 (#103); no preview is faked here;
// - no "Open decision pack" button: packs are AIV-P2-009 to AIV-P2-011 (#123 to #125), so no candidate is in one yet.
//   With no action, the view has no primary button until those land;
// - "Candidates" in the breadcrumb is text, not a link: the all-candidates page is AIV-P1-048 (#112), hidden until then;
// - the subtitle is the job and the application's intake stage ("Senior AI Engineer · New"), not "Round 1 complete · in
//   the Round 2 shortlist pack": rounds are AIV-P2-007 (#121) and packs AIV-P2-010 (#124);
// - the feature folder is `evidence-profile`, not the ticket's `candidate-profile`: every `features/candidate-*` folder is
//   candidate-site code to the architecture rules (ADR-009), which may not read the recruiter session;
// - "Roles without an approved rubric are not assessed." says "Jobs": the catalogue never calls a job a role
//   (packages/i18n/test/copy.test.ts);
// - "her" and "she" are "their" and "they": a person's gender is not recorded (ticket: pronoun-neutral copy);
// - "rank 1 of 64" counts the candidates the ranking lists (assessed on the approved rubric version), as the ranked table does;
// - a cited phrase is highlighted under its statement with its source's label, not inside the sentence: statements
//   cite an evidence item's quoted words (AIV-P1-033). It links to that item on its evidence card (AIV-P1-045), the
//   first card that cites it when it backs two competencies, and stays plain text if no card cites the item;
// - "Summary generated without AI" shows when the explanation is the template (AIV-P1-033), which the artboard does not draw;
// - the fit line sits beside the big score, under the bar, not under both: it is the shared ScoreWithUncertainty's caption;
// - a line under the fit gives the figures' basis, "Observed" (AGENTS.md 1.7), which the artboard does not draw;
// - the big score is the 28 px title size, not 40 px, and the card's padding is the shared Card's 16 px, not 24 px:
//   the tokens and @credalent/ui have neither;
// - the subtitle is the 14/20 px body size, not 15/22 px, and the "Why" heading the 16 px card size, not 15 px: the
//   tokens have no 15 px step;
// - a candidate not yet scored on the approved rubric shows "Not yet scored", basis "Not yet available" (AGENTS.md 1.7);
// - no "Against what the job needs" chart and competency bars: AIV-P1-044 (#108);
// - no "Needs live verification", "Interview history and score changes" or "Across your roles": AIV-P1-046 (#110);
// - no Credalent assistant panel or "Ask Credalent": AIV-P2-028 (#142); the sidebar, search and top bar are the shell's.

export type CandidateProfileView =
  { status: 'loading' } | { status: 'error'; onRetry: () => void } | ({ status: 'ready' } & ProfileData);

export function CandidateProfile({ view }: { view: CandidateProfileView }) {
  const t = useTranslations();
  if (view.status !== 'ready')
    return (
      <>
        <h1 className="mb-6 font-display text-title tracking-tight">{t('candidateProfile.title')}</h1>
        {view.status === 'loading' ? (
          <Card loading loadingLabel={t('candidateProfile.loading')} />
        ) : (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-body text-text">
            {t('candidateProfile.error')}
            <Button size="compact" onClick={view.onRetry}>
              {t('access.retry')}
            </Button>
          </div>
        )}
      </>
    );
  const name = view.name ?? t('ranking.unnamed');
  return (
    <div className="flex flex-col gap-6 self-stretch">
      <div className="flex flex-col gap-2.5">
        <nav aria-label={t('jobHeader.breadcrumb')} className="flex flex-wrap gap-1.5 text-meta text-text-2">
          <span>{t('shell.nav.candidates')}</span>
          <span aria-hidden="true">{'/'}</span>
          <span aria-current="page">{name}</span>
          <span aria-hidden="true">{'·'}</span>
          {/* jobPageHref builds the path from the job id, which typed routes cannot check. */}
          <Link
            href={jobPageHref(view.jobId, 'candidates') as Route}
            className="underline underline-offset-2 hover:text-text"
          >
            {t('candidateProfile.backToRanking', { job: view.jobTitle })}
          </Link>
        </nav>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="font-display text-title tracking-tight">{name}</h1>
          <p className="max-w-[72ch] text-body text-text-2">
            {[view.jobTitle, t(`ranking.stages.${view.stage}`)].join(' · ')}
          </p>
        </div>
      </div>
      <Card>
        <div className="flex flex-wrap items-start gap-x-10 gap-y-6">
          <section className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5">
            <h2 className="font-display text-section text-text">
              {t('candidateProfile.fitTitle', { job: view.jobTitle })}
            </h2>
            <FitBlock fit={view.fit} />
          </section>
          {view.fit.status === 'scored' && (
            <section className="flex min-w-0 flex-[2_1_420px] flex-col gap-2">
              <h3 className="text-card text-text">{t('candidateProfile.whyTitle')}</h3>
              <Why
                explanation={view.explanation}
                onCards={new Set(view.competencies.flatMap((card) => card.items.map((item) => item.id)))}
              />
            </section>
          )}
        </div>
      </Card>
      {(view.competencies.length > 0 || view.notes.length > 0) && (
        <EvidenceCards cards={view.competencies} notes={view.notes} />
      )}
    </div>
  );
}

function FitBlock({ fit }: { fit: Fit }) {
  const t = useTranslations();
  if (fit.status === 'awaiting_rubric')
    return <p className="text-body text-text-2">{t('candidateProfile.awaitingRubric')}</p>;
  if (fit.status === 'not_scored')
    return (
      <p className="flex flex-wrap items-center gap-2 text-body text-text">
        {t('ranking.notScored')}
        <ValueBasis basis="not-available" label={t('ranking.notYetAvailable')} />
      </p>
    );
  // "68 backed by evidence · up to 84 if their two open claims hold · meets the job's need on 4 of 6 competencies · rank 1 of 64"
  const line = (backed: number, upTo?: number) =>
    [
      t('score.backed', { backed }),
      upTo !== undefined && t('candidateProfile.upTo', { upTo, claims: fit.openClaims }),
      t('candidateProfile.meetsNeed', { meets: fit.meetsNeed, count: fit.competencyCount }),
      t('candidateProfile.rank', { rank: fit.rank, ranked: fit.ranked }),
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <>
      <div className="flex items-start gap-3.5">
        {/* The line beside the bar says the number again, with its meaning, so this one is for the eye only. */}
        {/* Drawn only for values ScoreWithUncertainty accepts, so no number ever stands beside "Score unavailable". */}
        {fit.backedScore >= 0 && fit.backedScore <= fit.upperBound && fit.upperBound <= 100 && (
          <span aria-hidden="true" className="font-display text-title tracking-tight text-text tabular-nums">
            {fit.backedScore}
          </span>
        )}
        <span className="min-w-0 flex-1 pt-2">
          <ScoreWithUncertainty
            backed={fit.backedScore}
            upTo={fit.upperBound}
            backedLabel={(backed) => line(backed)}
            captionLabel={line}
            upToLabel={(upTo) => t('score.upToCompact', { upTo })}
            unavailableLabel={t('score.unavailable')}
          />
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-meta text-text-2">
        <ValueBasis basis="observed" label={t('ranking.observed')} />
        {t('ranking.basis')}
      </p>
    </>
  );
}

function Why({ explanation, onCards }: { explanation: ProfileData['explanation']; onCards: ReadonlySet<string> }) {
  const t = useTranslations('candidateProfile');
  if (!explanation || explanation.statements.length === 0)
    return <p className="text-body text-text-2">{t('noExplanation')}</p>;
  return (
    <>
      <ul className="flex list-disc flex-col gap-1.5 ps-4.5 text-body text-text">
        {explanation.statements.map((statement, i) => (
          // The model may repeat a sentence, and statements are never reordered.
          <li key={`${i}:${statement.text}`}>
            {statement.text}
            {/* A citation with no item is the snapshot's own figures, which the statement already states. */}
            {statement.citations.map(({ itemId, label, quote }) => {
              if (!itemId) return null;
              const mark = (
                <EvidenceHighlight
                  text={quote}
                  citations={[{ start: 0, end: quote.length, sourceId: itemId }]}
                  markLabel={t('markLabel')}
                />
              );
              return (
                <span key={itemId + quote} className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {/* A plain in-page link: the browser scrolls to the item's card and moves the keyboard's place there. */}
                  {onCards.has(itemId) ? (
                    <a href={`#${evidenceAnchor(itemId)}`} className="rounded-xs">
                      {mark}
                    </a>
                  ) : (
                    <span>{mark}</span>
                  )}
                  <span className="text-meta text-text-2">{t('source', { label })}</span>
                </span>
              );
            })}
          </li>
        ))}
      </ul>
      {explanation.source === 'template' && <p className="text-meta text-text-2">{t('withoutAi')}</p>}
    </>
  );
}
