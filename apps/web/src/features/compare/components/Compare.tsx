'use client';

import { useTranslations } from '@credalent/i18n/react';
import {
  Button,
  Card,
  ProvenanceTag,
  ScoreWithUncertainty,
  StrengthMeter,
  ValueBasis,
  buttonClassName,
} from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { profileHref } from '@/features/evidence-profile/domain/profile.ts';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import { MAX_COMPARE, MIN_COMPARE, verdictOf, type CompareCell, type CompareData } from '../domain/compare.ts';

// AIV-P1-047: the comparison page, from the Compare artboard (docs/01-design/artboards/Compare.dc.html): breadcrumb,
// title and subtitle, "Change selection" and "Open decision pack", the grid of competencies by candidate, and "The
// trade-offs" (the page's `children`, Tradeoffs.tsx, with its own deviations).
// Deviations, each for an owner decision, a rule or a later ticket:
// - 2 to 10 candidates, not 2 or 3 (owner decision 26 Nov 2026): the grid scrolls sideways past the page's width and
//   the competency column stays in view, which the artboard's three columns never needed;
// - no "Round 1 outcome" row: nothing reads a candidate's interview-based score changes yet (AIV-P1-046, #110), and no
//   outcome is invented (AGENTS.md 1.7);
// - a cell's one-line summary is the first cited item's own words, cut to three lines, not a written summary: every
//   word shown is quoted evidence, and the profile has the rest;
// - a competency resting only on claims reads "Claim only" with an empty meter whatever strength the claim is stored
//   with, and "0 against N": a claim counts zero (AGENTS.md 1.6). The artboard draws such a cell as "Supporting · 1 against 2";
// - "Awaiting live defence" reads "To check in interview", as every provenance tag does (evidence.provenance);
// - the subtitle counts in figures ("The same 6 competencies"), as every count in the product does, not "six";
// - every candidate's name links to their profile, not only the first, and a nameless applicant reads "Unnamed applicant";
// - a candidate not yet scored on the approved rubric keeps their column, reading "Not yet scored", basis "Not yet
//   available" (AGENTS.md 1.5, 1.7): nobody ticked is dropped from the comparison;
// - a line under the grid gives the figures' basis, "Observed" (AGENTS.md 1.7), which the artboard does not draw;
// - "Open decision pack" opens the job's Decision page, where its packs are listed: a job may have several packs;
// - the subtitle is the 14/20 px body size, not 15/22 px, and the cards' padding is the shared Card's 16 px, not 24 px:
//   the tokens and @credalent/ui have neither;
// - no Credalent assistant panel or "Ask Credalent": AIV-P2-028 (#142); the sidebar, search and top bar are the shell's;
// - printed (AIV-P1-165), the breadcrumb and actions are left out, the grid is not cut at the page's edge, and a line
//   under the subtitle reads "Prepared <date> · Confidential": a hand-off the browser prints, nothing sent or generated.

export type CompareView = { status: 'loading' } | { status: 'error'; onRetry: () => void } | CompareData;

export function Compare({ view, children }: { view: CompareView; children?: ReactNode }) {
  const t = useTranslations();
  const title = <h1 className="font-display text-title tracking-tight">{t('compare.title')}</h1>;
  if (view.status === 'loading' || view.status === 'error')
    return (
      <div className="flex flex-col gap-6 self-stretch">
        {title}
        {view.status === 'loading' ? (
          <Card loading loadingLabel={t('compare.loading')} />
        ) : (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-body text-text">
            {t('compare.error')}
            <Button size="compact" onClick={view.onRetry}>
              {t('access.retry')}
            </Button>
          </div>
        )}
      </div>
    );
  // Built from opaque ids, which typed routes cannot check.
  const changeSelection = (variant: 'primary' | 'secondary') => (
    <Link href={view.selectionHref as Route} className={buttonClassName(variant)}>
      {t('compare.changeSelection')}
    </Link>
  );
  const breadcrumb = (
    <nav aria-label={t('jobHeader.breadcrumb')} className="flex flex-wrap gap-1.5 text-meta text-text-2 print:hidden">
      <Link href="/app/jobs" className="underline underline-offset-2 hover:text-text">
        {t('shell.nav.jobs')}
      </Link>
      <span aria-hidden="true">{'/'}</span>
      <Link
        href={jobPageHref(view.jobId, 'candidates') as Route}
        className="underline underline-offset-2 hover:text-text"
      >
        {view.jobTitle}
      </Link>
      <span aria-hidden="true">{'/'}</span>
      <span aria-current="page">{t('compare.crumb')}</span>
    </nav>
  );
  if (view.status !== 'ready')
    return (
      <div className="flex flex-col gap-6 self-stretch">
        <div className="flex flex-col gap-2.5">
          {breadcrumb}
          {title}
        </div>
        <p className="text-body text-text">
          {view.status === 'tooFew'
            ? t('compare.tooFew', { min: MIN_COMPARE, max: MAX_COMPARE })
            : t('compare.notOnJob')}
        </p>
        <div>{changeSelection('primary')}</div>
      </div>
    );
  return (
    <div className="flex flex-col gap-6 self-stretch">
      <div className="flex flex-col gap-2.5">
        {breadcrumb}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            {title}
            <p className="max-w-[72ch] text-body text-text-2">
              {view.rubricVersion === null
                ? t('compare.awaitingRubric', { job: view.jobTitle })
                : t('compare.subtitle', { job: view.jobTitle, version: view.rubricVersion, count: view.rows.length })}
            </p>
            <p className="hidden text-meta text-text-2 print:block">
              {t('decisionPack.preview.prepared', { date: view.preparedAt })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            {changeSelection('secondary')}
            <Link href={jobPageHref(view.jobId, 'pack') as Route} className={buttonClassName('primary')}>
              {t('compare.openPack')}
            </Link>
          </div>
        </div>
      </div>
      <Card className="min-w-0">
        {/* Every column's name is a link, so the keyboard reaches (and scrolls to) each one. */}
        <div className="-mx-4 overflow-x-auto print:overflow-visible">
          <table aria-label={t('compare.tableLabel')} className="w-full border-collapse text-start text-body">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky start-0 z-10 min-w-45 border-b border-border bg-surface px-4 py-2.5 text-start align-bottom text-meta font-semibold text-text-2"
                >
                  {t('compare.competency')}
                </th>
                {view.columns.map((column) => (
                  <th
                    key={column.candidateId}
                    scope="col"
                    className="min-w-58 border-b border-border px-3 py-2.5 text-start align-bottom font-normal last:pe-4"
                  >
                    <div className="flex flex-col gap-1.5">
                      <Link
                        href={profileHref(column.candidateId, view.jobId) as Route}
                        className="text-card font-semibold text-text underline-offset-2 hover:underline"
                      >
                        {column.name ?? t('ranking.unnamed')}
                      </Link>
                      {column.score ? (
                        <ScoreWithUncertainty
                          compact
                          backed={column.score.backed}
                          upTo={column.score.upTo}
                          backedLabel={(backed) => t('score.backed', { backed })}
                          captionLabel={(backed, upTo) => t('score.backedUpToCompact', { backed, upTo })}
                          upToLabel={(upTo) => t('score.upToCompact', { upTo })}
                          unavailableLabel={t('score.unavailable')}
                        />
                      ) : (
                        <span className="flex flex-wrap items-center gap-2 text-body text-text">
                          {t('ranking.notScored')}
                          <ValueBasis basis="not-available" label={t('ranking.notYetAvailable')} />
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.competencyId} className="group">
                  <th
                    scope="row"
                    className="sticky start-0 z-10 border-b border-border bg-surface px-4 py-3.5 text-start align-top font-semibold text-text group-last:border-b-0"
                  >
                    {row.name}
                    <span className="block text-meta font-normal text-text-2 tabular-nums">
                      {t('compare.rowMeta', { weight: row.weightPercent, needed: row.needed })}
                    </span>
                  </th>
                  {view.columns.map((column) => (
                    <td
                      key={column.candidateId}
                      className="border-b border-border px-3 py-3.5 align-top group-last:border-b-0 last:pe-4"
                    >
                      <Cell cell={column.cells[row.competencyId]} needed={row.needed} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-meta text-text-2">
          <ValueBasis basis="observed" label={t('ranking.observed')} />
          {t('ranking.basis')}
        </p>
      </Card>
      {children}
    </div>
  );
}

function Cell({ cell, needed }: { cell: CompareCell | undefined; needed: number }) {
  const t = useTranslations();
  if (!cell) return <span className="text-meta text-text-2">{t('ranking.notYetAvailable')}</span>;
  // SAFETY: a competency resting only on claims never reads under a claim's stored strength (AGENTS.md 1.6).
  const strength = cell.claimOnly ? 'claim' : cell.lead?.strength;
  return (
    <div className="flex flex-col items-start gap-1.5">
      {strength && <StrengthMeter strength={strength} label={t(`rubric.strength.${strength}`)} />}
      <span className="font-semibold text-text tabular-nums">
        {t(`compare.verdict.${verdictOf(cell.proven, needed)}`, { proven: cell.proven, needed })}
      </span>
      {cell.lead && (
        <ProvenanceTag provenance={cell.lead.provenance} label={t(`evidence.provenance.${cell.lead.provenance}`)} />
      )}
      <span className="line-clamp-3 text-meta text-text-2">{cell.summary ?? t('candidateProfile.noEvidence')}</span>
    </div>
  );
}
