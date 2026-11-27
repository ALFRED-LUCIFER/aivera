'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Card, ScoreWithUncertainty, ValueBasis, buttonClassName } from '@credalent/ui';
import type { Route } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { packHref } from '@/features/ranking/domain/pack.ts';
import { initials } from '@/features/shell/domain/shell.ts';
import type { PackPreview as Preview } from '../domain/pack.ts';
import { Needs, SummaryText } from './CardSummary.tsx';

// AIV-P1-116: the decision pack as the hiring owner will see it, in the workspace's branding, from the client view of
// the shortlist (docs/01-design/artboards/ClientPack.dc.html) with the header and "Powered by Credalent" of the shared
// email layout (ELayout.dc.html). Ported: the branded header, the title and lead, one card per candidate with their name,
// backed score and "up to N", "Backed by evidence" and "Still to test in the interview" as the pack's cited sentences
// (AIV-P2-011). Added for the tickets: the date prepared and "Confidential", the basis "Observed" (AGENTS.md 1.7), the
// pack's "Round 1 finding" and "Credalent's recommendation" (AIV-P2-011: the pack content feeds this shortlist), under
// each sentence the excerpt it quotes and its source, "Preparing summary" and "Summary unavailable" as on the pack page,
// and the "Powered by Credalent" footer. Nothing here sends, downloads or copies anything (AGENTS.md 1.5, 1.9).
// Deviations:
// - it is a frame inside the recruiter shell, under the job header, with "Back to the pack" and a line saying nothing is
//   sent: a preview the recruiter walks through on screen, not the hiring owner's own page; the secure link (AIV-P2-013,
//   #127) renders it on its own. So the title is an h2 and each name an h3, under the job header's h1, and the title
//   keeps the 28 px title size where the artboard draws clamp(28px, 4vw, 36px): a larger h2 would outrank the job
//   header's 28 px h1;
// - the logo is the workspace's initials on the default ink accent, as ELayout draws it, beside the workspace's name:
//   no logo or accent is stored until AIV-P2-077 (#520), so every workspace has the default header. The name is the
//   body font at 18 px bold, as ELayout draws it;
// - the header's line reads "Prepared <date> · Confidential" (the ticket's wording), not "Shared with you by your
//   recruiter · <date>": nothing is shared yet. ELayout's "Sent by … through Credalent" line and workspace footer
//   block are left out: they belong to emails (AIV-P2-077, #521);
// - the title is the pack's name and job ("Round 2 shortlist: Senior AI Engineer"), not "Senior AI Engineer: who should
//   we interview in Round 2?": the question is not stored;
// - a source names its item but links nowhere: the hiring owner sees summaries and sources, not the candidate's
//   profile or files (AGENTS.md 1.9). A card whose summary is unavailable lists the competencies that meet the job's
//   need and those short of it on the shared NeedVsProvenBar instead, from the assessment the member joined with;
// - the score reads "up to N if claims hold", not "up to N": the shared ScoreWithUncertainty caption every pack and
//   ranking uses (DESIGN.md), which says what the hatched part means. The longer caption shares the 320 px column, so
//   the bar is shorter than the artboard's;
// - no Interview, Hold or Pass choice, feedback field or "Send decisions to the recruiter": client choices are
//   AIV-P2-014 (#128, #129);
// - the cards' padding is the shared Card's 16 px, not 24 px, and "Powered by Credalent" the 13 px meta size, not 12 px:
//   @credalent/ui and the tokens have neither;
// - printed (AIV-P1-165), the line above the frame and "Back to the pack" are left out: the printout is the frame, with
//   its "Prepared <date> · Confidential", the job in its title, and every card. The browser prints it; nothing is sent.

export function PackPreview({ jobId, packId, preview }: { jobId: string; packId: string; preview: Preview }) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-4 self-stretch">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
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
              <span className="text-section font-bold text-text">{preview.workspace}</span>
            </span>
            <span className="text-meta text-text-2">
              {t('decisionPack.preview.prepared', { date: preview.preparedAt })}
            </span>
          </div>
        </header>
        <div className="mx-auto flex max-w-240 flex-col gap-6 px-5 pt-[clamp(28px,5vw,56px)] pb-16 sm:px-10">
          <div className="flex flex-col gap-2.5">
            <h2 id="preview-title" className="font-display text-title tracking-tight text-text">
              {t('decisionPack.title', { name: preview.name, job: preview.job })}
            </h2>
            <p className="max-w-[66ch] text-[16px] leading-6 text-text-2">
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
  const { summary } = member;
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
          {summary.status === 'ready' ? (
            // The preview has no evidence cards, so a source names its item and links nowhere.
            <SummaryText
              summary={summary.summary}
              labels={{ strengths: t('decisionPack.preview.strengths'), risks: t('decisionPack.preview.risks') }}
              hrefFor={undefined}
            />
          ) : summary.status === 'preparing' ? (
            <output className="block text-body text-text-2">{t('decisionPack.summary.preparing')}</output>
          ) : (
            <>
              <p className="text-body text-text-2">{t('decisionPack.summary.unavailable')}</p>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-x-8 gap-y-4">
                <Needs
                  title={t('decisionPack.preview.strengths')}
                  rows={summary.strengths}
                  empty={t('decisionPack.preview.noStrengths')}
                />
                <Needs
                  title={t('decisionPack.preview.risks')}
                  rows={summary.risks}
                  empty={t('decisionPack.preview.noRisks')}
                />
              </div>
            </>
          )}
        </div>
      </Card>
    </section>
  );
}
