'use client';

import { useTranslations } from '@credalent/i18n/react';
import {
  Card,
  EvidenceHighlight,
  NeedVsProvenBar,
  ScoreWithUncertainty,
  ValueBasis,
  buttonClassName,
} from '@credalent/ui';
import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { packHref } from '@/features/ranking/domain/pack.ts';
import type { NeedRow } from '@/features/evidence-profile/domain/needs.ts';
import { initials } from '@/features/shell/domain/shell.ts';
import type { PackPreview as Preview, PreviewExplanation } from '../domain/pack.ts';

// AIV-P1-116: the decision pack as the hiring owner will see it, in the workspace's branding, from the client view of
// the shortlist (docs/01-design/artboards/ClientPack.dc.html) with the header and "Powered by Credalent" of the shared
// email layout (ELayout.dc.html). Ported: the branded header, the title and lead, one card per candidate with their name,
// backed score and "up to N", "Backed by evidence" and "Still to test in the interview". Added for the ticket: the date
// prepared and "Confidential", the basis "Observed" (AGENTS.md 1.7), Credalent's cited summary per candidate, and the
// "Powered by Credalent" footer. Nothing here sends, downloads or copies anything (AGENTS.md 1.5, 1.9).
// Deviations:
// - it is a frame inside the recruiter shell, under the job header, with "Back to the pack" and a line saying nothing is
//   sent: a preview the recruiter walks through on screen, not the hiring owner's own page; the secure link (AIV-P2-013,
//   #127) renders it on its own. So the title is an h2 and each name an h3, under the job header's h1;
// - the logo is the workspace's initials on the default ink accent, as ELayout draws it, beside the workspace's name:
//   no logo or accent is stored until AIV-P2-077 (#520), so every workspace has the default header;
// - the header's line reads "Prepared <date> · Confidential" (the ticket's wording), not "Shared with you by your
//   recruiter · <date>": nothing is shared yet. ELayout's "Sent by … through Credalent" line and workspace footer
//   block are left out: they belong to emails (AIV-P2-077, #521);
// - the title is the pack's name and job ("Round 2 shortlist: Senior AI Engineer"), not "Senior AI Engineer: who should
//   we interview in Round 2?": the question is not stored;
// - "Backed by evidence" and "Still to test in the interview" list the competencies that meet the job's need and those
//   short of it, each on the shared NeedVsProvenBar, not a sentence: the generated sentences are AIV-P2-011 (#125).
//   shortcut: a level names no source here (only the summary cites evidence); cite each level's items when AIV-P2-011
//   (#125) writes the pack's cited strengths;
// - Credalent's summary is the cited ranking explanation (AIV-P1-033), each cited phrase highlighted with its source,
//   until AIV-P2-011 (#125) generates the pack's recommendation; a member whose assessment changed after joining shows
//   "Summary unavailable" with the pack's scores. The statements render as the profile's "Why they are ranked here"
//   does, without its links to evidence cards (the preview has none); that renderer is the evidence profile's own
//   component, which a feature may not import, and AIV-P2-011 (#125) replaces this one;
// - no Interview, Hold or Pass choice, feedback field or "Send decisions to the recruiter": client choices are
//   AIV-P2-014 (#128, #129);
// - the cards' padding is the shared Card's 16 px, not 24 px, and "Powered by Credalent" the 13 px meta size, not 12 px:
//   @credalent/ui and the tokens have neither.

export function PackPreview({ jobId, packId, preview }: { jobId: string; packId: string; preview: Preview }) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-4 self-stretch">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-text-2">{t('decisionPack.preview.note')}</p>
        {/* packHref builds the path from opaque ids, which typed routes cannot check. */}
        <Link href={packHref(jobId, packId) as Route} className={buttonClassName('secondary')}>
          {t('decisionPack.preview.back')}
        </Link>
      </div>
      <article
        aria-labelledby="preview-title"
        className="overflow-hidden rounded-card border border-border bg-bg shadow-1"
      >
        <div aria-hidden="true" className="h-1 bg-action" />
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-240 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5 sm:px-10">
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="grid size-8 flex-none place-items-center rounded-control bg-action text-meta font-bold text-on-action"
              >
                {initials(preview.workspace)}
              </span>
              <span className="font-display text-section font-bold text-text">{preview.workspace}</span>
            </span>
            <span className="text-meta text-text-2">
              {t('decisionPack.preview.prepared', { date: preview.preparedAt })}
            </span>
          </div>
        </header>
        <div className="mx-auto flex max-w-240 flex-col gap-6 px-5 pt-8 pb-12 sm:px-10">
          <div className="flex flex-col gap-2.5">
            <h2 id="preview-title" className="font-display text-title tracking-tight text-text">
              {t('decisionPack.title', { name: preview.name, job: preview.job })}
            </h2>
            <p className="max-w-[66ch] text-body text-text-2">
              {t('decisionPack.preview.lead', { count: preview.members.length })}
            </p>
          </div>
          {preview.members.map((m) => (
            <Member key={m.candidateId} member={m} />
          ))}
          <p className="flex flex-wrap items-center gap-2 text-meta text-text-2">
            <ValueBasis basis="observed" label={t('ranking.observed')} />
            {t('decisionPack.basis')}
          </p>
        </div>
        <footer className="flex items-center justify-center gap-2 border-t border-border px-8 py-2.5 text-meta text-text-2">
          <Image src="/brand/credalent-mark.png" alt="" width={14} height={14} className="rounded-xs" />
          {t('decisionPack.preview.poweredBy')}
        </footer>
      </article>
    </div>
  );
}

function Member({ member }: { member: Preview['members'][number] }) {
  const t = useTranslations();
  const name = member.name ?? t('ranking.unnamed');
  const titleId = `preview-${member.candidateId}`;
  return (
    <section aria-labelledby={titleId}>
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <h3 id={titleId} className="flex-[1_1_200px] font-display text-section text-text">
              {name}
            </h3>
            <span className="max-w-80 min-w-60 flex-[1_1_240px]">
              <ScoreWithUncertainty
                compact
                backed={member.backedScore}
                upTo={member.upperBound}
                backedLabel={(backed) => t('score.backed', { backed })}
                captionLabel={(backed, upTo) => t('score.backedUpToCompact', { backed, upTo })}
                upToLabel={(upTo) => t('score.upToCompact', { upTo })}
                unavailableLabel={t('score.unavailable')}
              />
            </span>
          </div>
          {member.summary ? (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-x-8 gap-y-4">
                <Needs
                  title={t('decisionPack.preview.strengths')}
                  rows={member.summary.strengths}
                  empty={t('decisionPack.preview.noStrengths')}
                />
                <Needs
                  title={t('decisionPack.preview.risks')}
                  rows={member.summary.risks}
                  empty={t('decisionPack.preview.noRisks')}
                />
              </div>
              {member.summary.explanation && member.summary.explanation.statements.length > 0 && (
                <Summary explanation={member.summary.explanation} />
              )}
            </>
          ) : (
            <p className="text-body text-text-2">{t('decisionPack.preview.unavailable')}</p>
          )}
        </div>
      </Card>
    </section>
  );
}

function Needs({ title, rows, empty }: { title: string; rows: NeedRow[]; empty: string }) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-meta font-semibold text-text-2">{title}</span>
      {rows.length === 0 ? (
        <p className="text-body text-text">{empty}</p>
      ) : (
        <ul aria-label={title} className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.competencyId}>
              <NeedVsProvenBar
                name={row.name}
                proven={row.proven}
                claimed={row.claimed}
                needed={row.needed}
                levelLabel={(v) => t('score.level', v)}
                barLabel={(v) => t('againstNeed.bar', { ...v, name: row.name })}
                aboveLabel={t('score.aboveNeed')}
                meetsLabel={t('score.meetsNeed')}
                shortLabel={(short, claimed) => t(claimed ? 'score.shortClaimed' : 'score.short', { short })}
                unavailableLabel={t('score.unavailable')}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Summary({ explanation }: { explanation: PreviewExplanation }) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-4">
      <span className="text-meta font-semibold text-text-2">{t('decisionPack.preview.summary')}</span>
      <ul className="flex list-disc flex-col gap-1.5 ps-4.5 text-body text-text">
        {explanation.statements.map((statement, i) => (
          // The model may repeat a sentence, and statements are never reordered.
          <li key={`${i}:${statement.text}`}>
            {statement.text}
            {/* A citation with no item is the snapshot's own figures, which the statement already states. */}
            {statement.citations.map(({ itemId, label, quote }) =>
              itemId ? (
                <span key={itemId + quote} className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span>
                    <EvidenceHighlight
                      text={quote}
                      citations={[{ start: 0, end: quote.length, sourceId: itemId }]}
                      markLabel={t('candidateProfile.markLabel')}
                    />
                  </span>
                  <span className="text-meta text-text-2">{t('candidateProfile.source', { label })}</span>
                </span>
              ) : null,
            )}
          </li>
        ))}
      </ul>
      {explanation.source === 'template' && <p className="text-meta text-text-2">{t('candidateProfile.withoutAi')}</p>}
    </div>
  );
}
