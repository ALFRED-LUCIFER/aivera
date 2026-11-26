'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card, EvidenceHighlight } from '@credalent/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { closingOf, type CompareColumn, type TradeoffsView } from '../domain/compare.ts';

// AIV-P1-047: "The trade-offs" of the Compare artboard, written by the model from cited evidence.
// Deviations, each for a rule or a recorded shortcut:
// - written when a person asks ("Write the trade-offs"), not with the page: every summary is a model call on the
//   workspace's AI allowance, and none is stored yet (assessment `compareTradeoffs`, shortcut);
// - a line under the title says the summary is AI-written and recommends nobody, which the artboard does not draw;
// - a list of sentences for each candidate, not a paragraph under a first name: a fact of the snapshot (what compares
//   candidates is written from the snapshots, never by the model) starts with the candidate's whole name, since two
//   candidates may share a first name, and what the model says of a piece of work is a sentence of its own;
// - a cited phrase is highlighted under its statement with its source's label and links to that item on the
//   candidate's profile, as "Why they are ranked here" does; in a statement of the snapshot's facts the name links to
//   the profile, where the evidence behind them is;
// - no "he", "she" or "her": a person's gender is not recorded;
// - the closing line counts in figures ("7 points separate the 3 candidates"), with its basis, "Observed" being the
//   grid's; "A difference this small is within what Round 2 could change." shows only when a lower candidate's "up to"
//   reaches the highest backed score, so it is never said of a gap claims could not close (AGENTS.md 1.7).

export type TradeoffsProps = {
  view: TradeoffsView | null;
  pending: boolean;
  onWrite: () => void;
  columns: readonly Pick<CompareColumn, 'score'>[];
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
                {view.candidates.map((candidate) => (
                  <ul key={candidate.candidateId} className="flex flex-col gap-1.5 text-body text-text-2">
                    {candidate.statements.map((statement, i) => (
                      // The model may repeat a sentence, and statements are never reordered.
                      <li key={`${i}:${statement.text}`}>
                        {statement.ofSnapshot && (
                          <>
                            {/* Built from opaque ids, which typed routes cannot check. */}
                            <Link
                              href={candidate.profileHref as Route}
                              className="font-semibold text-text underline-offset-2 hover:underline"
                            >
                              {candidate.name ?? tAll('ranking.unnamed')}
                            </Link>{' '}
                          </>
                        )}
                        {statement.text}
                        {statement.citations.map((cited) => (
                          <span key={cited.key} className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            {/* Built from opaque ids, which typed routes cannot check. */}
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
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
              {closing && (
                <p className="text-meta text-text-2 tabular-nums">
                  {t('closing', { points: closing.points, count: closing.count })}
                  {closing.couldChange && ` ${t('couldChange')}`}
                </p>
              )}
            </>
          )}
          {view?.status === 'unavailable' && !pending && <p className="text-body text-text">{t('unavailable')}</p>}
        </div>
        {closing === null ? (
          <p className="text-body text-text-2">{t('notScored')}</p>
        ) : (
          view?.status !== 'written' && (
            <div>
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
