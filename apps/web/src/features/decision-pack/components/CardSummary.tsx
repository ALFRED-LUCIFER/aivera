'use client';

import type { CitedStatement, MemberSummary } from '@credalent/decisions';
import { useTranslations } from '@credalent/i18n/react';
import { EvidenceHighlight, NeedVsProvenBar, ProvenanceTag } from '@credalent/ui';
import { useId } from 'react';
import type { NeedRow } from '@/features/evidence-profile/domain/needs.ts';
import { numberedSources } from '../domain/pack.ts';

// AIV-P2-011: a pack member's card text, shared by the pack page and the hiring owner's preview. Every statement names
// the evidence it rests on by number. Each section then shows one cited excerpt and its numbered sources (AIV-P1-165),
// each linked to the item's card on the candidate's profile where `hrefFor` gives an address (the preview has none);
// "Source: the assessment" is a statement resting on the snapshot's own facts. The highlighter marks cited evidence
// only; a quote of the candidate's own words (a CV) is a claim, shown as plain text under the shared "Claim" tag, never
// highlighted, and its source carries the tag too (AGENTS.md 1.6, DESIGN.md).

type Citations = CitedStatement['citations'];
/** The address of an evidence item's card on the candidate's profile, or of the profile for the assessment (null). */
type HrefFor = ((itemId: string | null) => string) | undefined;

const mark = (sources: Citations, citations: Citations) =>
  [...new Set(citations.map((c) => sources.findIndex((s) => s.itemId === c.itemId) + 1))].map((n) => `[${n}]`).join('');

/** One excerpt of the section's cited evidence, then every source it cites, numbered as its statements name them. */
function Sources({ citations, hrefFor }: { citations: Citations; hrefFor: HrefFor }) {
  const t = useTranslations();
  const sources = numberedSources(citations);
  // Inspected work before the candidate's own words; the assessment's facts are the page's own figures, not an excerpt.
  const shown = sources.find((s) => s.itemId !== null && !s.claim) ?? sources.find((s) => s.itemId !== null);
  return (
    <>
      {shown && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body text-text">
          {shown.claim ? (
            <>
              <ProvenanceTag provenance="claim" label={t('evidence.provenance.claim')} />
              <span>{shown.quote}</span>
            </>
          ) : (
            <EvidenceHighlight
              text={shown.quote}
              citations={[{ start: 0, end: shown.quote.length, sourceId: shown.itemId ?? '' }]}
              markLabel={t('candidateProfile.markLabel')}
            />
          )}
          <span className="text-meta text-text-2">{`[${sources.indexOf(shown) + 1}]`}</span>
        </div>
      )}
      <ol aria-label={t('decisionPack.summary.sources')} className="mt-1 flex flex-col gap-1 text-meta text-text-2">
        {sources.map(({ itemId, label, claim }, i) => {
          const text =
            itemId === null ? t('decisionPack.summary.assessment') : t('decisionPack.summary.source', { label });
          return (
            <li key={itemId ?? 'facts'} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span>{`[${i + 1}]`}</span>
              {claim && <ProvenanceTag provenance="claim" label={t('evidence.provenance.claim')} />}
              {hrefFor ? (
                <a href={hrefFor(itemId)} className="underline underline-offset-2">
                  {text}
                </a>
              ) : (
                <span>{text}</span>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** A labelled list of cited statements, or `empty` when there is none. */
export function Statements({
  title,
  statements,
  empty,
  hrefFor,
}: {
  title: string;
  statements: CitedStatement[];
  empty: string;
  hrefFor: HrefFor;
}) {
  const titleId = useId();
  const citations = statements.flatMap((s) => s.citations);
  const sources = numberedSources(citations);
  return (
    <div className="flex flex-col gap-1">
      <span id={titleId} className="text-meta font-semibold text-text-2">
        {title}
      </span>
      {statements.length === 0 ? (
        <p className="text-body text-text">{empty}</p>
      ) : (
        <>
          <ul aria-labelledby={titleId} className="flex flex-col gap-2 text-body text-text">
            {statements.map((s, i) => (
              // The model may repeat a sentence, and statements are never reordered.
              <li key={`${i}:${s.text}`}>
                {s.text} <span className="text-meta text-text-2">{mark(sources, s.citations)}</span>
              </li>
            ))}
          </ul>
          <Sources citations={citations} hrefFor={hrefFor} />
        </>
      )}
    </div>
  );
}

/**
 * Strengths, risks and the Round 1 finding (left out when the interview gave none), side by side as the Pack artboard
 * draws them, then the recommendation: the recruiter's to give, so `labels.recommendation` says whose it is, marked
 * "Prepared with Credalent".
 */
export function SummaryText({
  summary,
  labels,
  hrefFor,
}: {
  summary: MemberSummary;
  labels: { strengths: string; risks: string; recommendation: string };
  hrefFor: HrefFor;
}) {
  const t = useTranslations('decisionPack.summary');
  const { recommendation } = summary;
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-x-8 gap-y-4">
        <Statements title={labels.strengths} statements={summary.strengths} empty={t('none')} hrefFor={hrefFor} />
        <Statements title={labels.risks} statements={summary.risks} empty={t('none')} hrefFor={hrefFor} />
        {summary.round1 && (
          <Statements title={t('round1')} statements={[summary.round1]} empty={t('none')} hrefFor={hrefFor} />
        )}
      </div>
      {/* Advice for the person who decides: no decision is offered or chosen here (AGENTS.md 1.5). */}
      <div className="flex flex-col gap-1 border-t border-border pt-4 text-body text-text-2">
        <p>
          {labels.recommendation}{' '}
          <strong className="font-semibold text-text">
            {t('action', {
              action: recommendation.action,
              hasFocus: recommendation.focus ? 'yes' : 'no',
              focus: recommendation.focus ?? '',
            })}
          </strong>{' '}
          <span className="text-meta">{mark(numberedSources(recommendation.citations), recommendation.citations)}</span>
        </p>
        <p className="text-meta">{t('preparedWith')}</p>
        <Sources citations={recommendation.citations} hrefFor={hrefFor} />
      </div>
    </>
  );
}

/** The assessment's own competencies against the job's need, each on the shared NeedVsProvenBar. */
// shortcut: a level here names no source (only the summary's statements cite evidence); cite each level's items when
// the "Summary unavailable" state needs them (AIV-P1-116's note, kept for the cards with no usable summary).
export function Needs({ title, rows, empty }: { title: string; rows: NeedRow[]; empty: string }) {
  const t = useTranslations();
  const titleId = useId();
  return (
    <div className="flex flex-col gap-1">
      <span id={titleId} className="text-meta font-semibold text-text-2">
        {title}
      </span>
      {rows.length === 0 ? (
        <p className="text-body text-text">{empty}</p>
      ) : (
        <ul aria-labelledby={titleId} className="flex flex-col divide-y divide-border">
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
