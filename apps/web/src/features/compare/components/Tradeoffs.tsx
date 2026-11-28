'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card, EvidenceHighlight, ValueBasis } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { closingOf, type CompareColumn, type TradeoffsView } from '../domain/compare.ts';

// AIV-P1-047: "The trade-offs" of the Compare artboard: for each candidate, what the model picked as worth reading
// first, shown word for word from its source.
// Deviations, each for a rule or a recorded shortcut:
// - no sentence here is written by the model, where the artboard draws a written paragraph for each candidate: a fact
//   that compares candidates is written from their snapshots, and what is said of a piece of work is that work's cited
//   excerpt, whole. Model prose reworded the facts and could carry a comparison or advice (AGENTS.md 1.5, 1.6);
// - shown when a person asks ("Show the trade-offs"), not with the page: every ask is a model call on the workspace's
//   AI allowance, and none is stored yet (assessment `compareTradeoffs`, shortcut);
// - a line under the title says the model picked these and recommends nobody, which the artboard does not draw;
// - a list for each candidate, every item naming them by their whole name (two candidates may share a first name): a
//   fact reads "<name> is the only one compared with …", an excerpt "Cited evidence for <name>: …". The name links to their
//   profile, and a cited excerpt, highlighted with its source's label, to that item there;
// - no "he", "she" or "her": a person's gender is not recorded; "independently checked", never "inspected";
// - the closing line counts in figures ("7 points separate the 3 candidates"), with its basis, "Observed". The
//   artboard's "A difference this small is within what Round 2 could change." is "Claims still to check could change
//   this order.", shown only when a lower candidate's "up to" reaches the highest backed score: no gap is called small
//   (AGENTS.md 1.7);
// - printed (AIV-P1-165), "Show the trade-offs" is left out: a printout has no controls;
// - with someone compared not scored yet, the trade-offs are of the scored candidates and a line names each one who is
//   not ("Priya Nair is not scored yet."); the artboard draws only three scored candidates (AIV-P1-165 §10).

export type TradeoffsProps = {
  view: TradeoffsView | null;
  pending: boolean;
  onWrite: () => void;
  /** Everyone compared: the trade-offs are of those scored, and each one not scored yet is named (AIV-P1-165 §10). */
  columns: readonly Pick<CompareColumn, 'candidateId' | 'name' | 'score'>[];
};

export function Tradeoffs({ view, pending, onWrite, columns }: TradeoffsProps) {
  const t = useTranslations('compare.tradeoffs');
  const tAll = useTranslations();
  const closing = closingOf(columns);
  return (
    <Card>
      <section aria-labelledby="tradeoffs-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="tradeoffs-title" className="font-display text-section text-text">
            {t('title')}
          </h2>
          <p className="text-meta text-text-2">{t('intro')}</p>
        </div>
        {/* Announced when it arrives: the button that asked for it is gone by then. */}
        <div aria-live="polite" className="flex flex-col gap-3">
          {view?.status === 'written' && !pending && (
            <>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-x-8 gap-y-4">
                {view.candidates.map((candidate) => {
                  const name = candidate.name ?? tAll('ranking.unnamed');
                  return (
                    <ul
                      key={candidate.candidateId}
                      aria-label={name}
                      className="flex flex-col gap-1.5 text-body text-text-2"
                    >
                      {candidate.statements.map((statement) => (
                        // SAFETY: every statement names its candidate, so no fact or work reads as someone else's.
                        <li key={statement.text}>
                          {statement.ofSnapshot ? (
                            <>
                              {/* Built from opaque ids, which typed routes cannot check. */}
                              <Link
                                href={candidate.profileHref as Route}
                                className="font-semibold text-text underline-offset-2 hover:underline"
                              >
                                {name}
                              </Link>{' '}
                              {statement.text}
                            </>
                          ) : (
                            <>
                              <span className="font-semibold text-text">{t('work', { name })}</span>
                              {statement.citations.map((cited) => (
                                <span key={cited.key} className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                  <Link href={cited.href as Route} className="rounded-xs text-text">
                                    <EvidenceHighlight
                                      text={cited.quote}
                                      citations={[{ start: 0, end: cited.quote.length, sourceId: cited.key }]}
                                      markLabel={tAll('candidateProfile.markLabel')}
                                    />
                                  </Link>
                                  <span className="text-meta text-text-2">
                                    {tAll('candidateProfile.source', { label: cited.label })}
                                  </span>
                                </span>
                              ))}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  );
                })}
              </div>
              {closing && (
                <p className="flex flex-wrap items-center gap-2 text-meta text-text-2 tabular-nums">
                  <ValueBasis basis="observed" label={tAll('ranking.observed')} />
                  {t('closing', { points: closing.points, count: closing.count, partial: String(closing.partial) })}
                  {closing.couldChange && ` ${t('couldChange')}`}
                </p>
              )}
            </>
          )}
          {view?.status === 'unavailable' && !pending && <p className="text-body text-text">{t('unavailable')}</p>}
        </div>
        {closing &&
          columns
            .filter((column) => !column.score)
            .map((column) => (
              <p key={column.candidateId} className="text-body text-text-2">
                {t('notScoredYet', { name: column.name ?? tAll('ranking.unnamed') })}
              </p>
            ))}
        {closing === null ? (
          <p className="text-body text-text-2">{t('notScored')}</p>
        ) : (
          view?.status !== 'written' && (
            <div className="print:hidden">
              <Button size="compact" disabled={pending} onClick={onWrite}>
                {pending ? t('writing') : t(view ? 'again' : 'write')}
              </Button>
            </div>
          )
        )}
      </section>
    </Card>
  );
}
