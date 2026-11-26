'use client';

import type { CitedStatement, MemberSummary } from '@credalent/decisions';
import { useTranslations } from '@credalent/i18n/react';
import { EvidenceHighlight, NeedVsProvenBar } from '@credalent/ui';
import { useId } from 'react';
import type { NeedRow } from '@/features/evidence-profile/domain/needs.ts';

// AIV-P2-011: a pack member's card text, shared by the pack page and the hiring owner's preview. Every statement shows
// the evidence it rests on: each quoted excerpt highlighted with its source, linked to the item's card on the
// candidate's profile where `hrefFor` gives an address (the preview has none), or "Source: the assessment" for a
// statement resting on the snapshot's own facts (AGENTS.md 1.6).

type HrefFor = ((itemId: string) => string) | undefined;

function Sources({ citations, hrefFor }: { citations: CitedStatement['citations']; hrefFor: HrefFor }) {
  const t = useTranslations();
  return (
    <>
      {citations.map(({ itemId, label, quote }, i) =>
        itemId === null ? null : (
          <span key={`${i}:${itemId}`} className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <EvidenceHighlight
              text={quote}
              citations={[{ start: 0, end: quote.length, sourceId: itemId }]}
              markLabel={t('candidateProfile.markLabel')}
            />
            {hrefFor ? (
              <a href={hrefFor(itemId)} className="text-meta text-text-2 underline underline-offset-2">
                {t('decisionPack.summary.source', { label })}
              </a>
            ) : (
              <span className="text-meta text-text-2">{t('decisionPack.summary.source', { label })}</span>
            )}
          </span>
        ),
      )}
      {citations.every((c) => c.itemId === null) && (
        <span className="mt-1 block text-meta text-text-2">{t('decisionPack.summary.assessment')}</span>
      )}
    </>
  );
}

function Statement({ statement, hrefFor }: { statement: CitedStatement; hrefFor: HrefFor }) {
  return (
    <>
      {statement.text}
      <Sources citations={statement.citations} hrefFor={hrefFor} />
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
  return (
    <div className="flex flex-col gap-1">
      <span id={titleId} className="text-meta font-semibold text-text-2">
        {title}
      </span>
      {statements.length === 0 ? (
        <p className="text-body text-text">{empty}</p>
      ) : (
        <ul aria-labelledby={titleId} className="flex flex-col gap-2 text-body text-text">
          {statements.map((s, i) => (
            // The model may repeat a sentence, and statements are never reordered.
            <li key={`${i}:${s.text}`}>
              <Statement statement={s} hrefFor={hrefFor} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Strengths, risks and the Round 1 finding, side by side as the Pack artboard draws them, then the recommendation. */
export function SummaryText({
  summary,
  labels,
  hrefFor,
}: {
  summary: MemberSummary;
  labels: { strengths: string; risks: string };
  hrefFor: HrefFor;
}) {
  const t = useTranslations('decisionPack.summary');
  const { recommendation } = summary;
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-x-8 gap-y-4">
        <Statements
          title={labels.strengths}
          statements={summary.strengths}
          empty={t('noStrengths')}
          hrefFor={hrefFor}
        />
        <Statements title={labels.risks} statements={summary.risks} empty={t('noRisks')} hrefFor={hrefFor} />
        <Statements
          title={t('round1')}
          statements={summary.round1 ? [summary.round1] : []}
          empty={t('noRound1')}
          hrefFor={hrefFor}
        />
      </div>
      {/* Advice for the person who decides: no decision is offered or chosen here (AGENTS.md 1.5). */}
      <div className="flex flex-col gap-1 border-t border-border pt-4 text-body text-text-2">
        <p>
          {t('recommendation')}{' '}
          <strong className="font-semibold text-text">
            {t('action', {
              action: recommendation.action,
              hasFocus: recommendation.focus ? 'yes' : 'no',
              focus: recommendation.focus ?? '',
            })}
          </strong>
        </p>
        <Sources citations={recommendation.citations} hrefFor={hrefFor} />
      </div>
    </>
  );
}

/** The assessment's own competencies against the job's need, each on the shared NeedVsProvenBar. */
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
