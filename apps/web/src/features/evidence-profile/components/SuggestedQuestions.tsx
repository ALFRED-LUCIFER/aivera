'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Button, Card, EvidenceHighlight } from '@credalent/ui';
import type { QuestionsView } from '../domain/questions.ts';

// AIV-P1-113: "Needs live verification" of the Candidate artboard (docs/01-design/artboards/Candidate.dc.html): a
// card with the heading and, under it, what to test live with this candidate.
// Deviations, each for the ticket, a rule or a later ticket:
// - the heading is "Interview questions", not the artboard's "Needs live verification": it is what the profile's "On
//   this page" links name, and the heading takes focus from them (AIV-P1-165 §11);
// - the artboard draws one line per gap; here each gap is its competency's name with 2 or 3 suggested questions under
//   it, each with the words it cites, their source and "A strong answer shows" and "A weak answer shows" (the ticket);
// - a "Suggest interview questions" button, which the artboard does not draw: questions are asked for on demand, one
//   model call a person, so the AI allowance is spent only on people the recruiter is considering (the ticket). It is
//   a secondary button: asking changes nothing about the candidate;
// - states the artboard does not draw: asking ("Suggesting interview questions…"), "Waiting for tomorrow's AI
//   allowance", "Questions could not be suggested. You can write your own.", "Evidence changed since these questions
//   were suggested." with "Suggest again", and "No open gaps. Nothing here needs live verification.";
// - a line saying the questions are suggestions for a person and change no score, stage or rank (AGENTS.md 1.5);
// - no "See interviews" button: the interviews page is AIV-P2-007 (#121), and a link to nothing is not shipped;
// - the card is full width under "Competency by competency", not in a right column: that column's other cards,
//   "Interview history and score changes" and "Across your roles", are AIV-P1-046 (#110);
// - a question's cited words are highlighted only when they are inspected work; a claim's words are quoted plain. The
//   ticket's Gherkin asks for the CV line "raised answer accuracy from 71% to 88%" highlighted, but on this page a
//   claim is never highlighted, whatever its strength (AGENTS.md 1.6, as the evidence cards above, AIV-P1-045);
// - a source is named as text ("CV, page 1"), not a link: the evidence card above links it;
// - the questions are ink, not the artboard's muted grey: they are what the recruiter reads to act; the notes are muted;
// - the padding is the shared Card's 16 px, not 20 px: @credalent/ui has no other.

export type SuggestedQuestionsProps = {
  view: QuestionsView;
  /** Why the last request gave no questions: today's AI allowance is spent, or the answer was refused. */
  problem: 'waiting' | 'failed' | null;
  pending: boolean;
  onSuggest: () => void;
};

export function SuggestedQuestions({ view, problem, pending, onSuggest }: SuggestedQuestionsProps) {
  const t = useTranslations('suggestedQuestions');
  const tProfile = useTranslations('candidateProfile');
  const gaps = view.status === 'suggested' ? view.gaps : [];
  const stale = view.status === 'suggested' && view.stale;
  return (
    <Card>
      <section aria-labelledby="questions" className="flex flex-col gap-3">
        <h2 id="questions" tabIndex={-1} className="scroll-mt-6 font-display text-section text-text">
          {t('title')}
        </h2>
        {view.status === 'no_gaps' ? (
          <p className="text-body text-text-2">{t('noGaps')}</p>
        ) : (
          <>
            <p className="max-w-[72ch] text-meta text-text-2">{t('intro')}</p>
            {gaps.map((gap) => (
              // A labelled section, not an article: the page's articles are the evidence cards above.
              <section
                key={gap.competencyId}
                aria-labelledby={`questions-${gap.competencyId}`}
                className="-mx-4 flex flex-col gap-2.5 border-t border-border px-4 pt-3.5"
              >
                <h3 id={`questions-${gap.competencyId}`} className="text-card text-text">
                  {gap.name}
                </h3>
                <ol className="flex max-w-[72ch] list-decimal flex-col gap-3.5 ps-4.5 text-body text-text">
                  {gap.questions.map((question, i) => (
                    // The model may repeat a question, and questions are never reordered.
                    <li key={`${i}:${question.text}`} className="flex flex-col gap-1">
                      <span>{question.text}</span>
                      {question.citations.map((cited) => (
                        <span key={cited.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          {/* SAFETY: only inspected work is highlighted; a claim's words stay plain (AGENTS.md 1.6). */}
                          {cited.highlighted ? (
                            <span>
                              <EvidenceHighlight
                                text={cited.quote}
                                citations={[{ start: 0, end: cited.quote.length, sourceId: cited.key }]}
                                markLabel={tProfile('markLabel')}
                              />
                            </span>
                          ) : (
                            <q>{cited.quote}</q>
                          )}
                          <span className="font-mono text-meta text-text-2">
                            {tProfile('source', { label: cited.label ?? t('rubric') })}
                          </span>
                        </span>
                      ))}
                      <span className="text-meta text-text-2">
                        <strong className="font-semibold text-text">{t('strong')}</strong> {question.strongAnswer}
                      </span>
                      <span className="text-meta text-text-2">
                        <strong className="font-semibold text-text">{t('weak')}</strong> {question.weakAnswer}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
            {stale && <p className="text-body text-text">{t('stale')}</p>}
            {problem && !pending && (
              <p role="alert" className="text-body text-text">
                {t(problem)}
              </p>
            )}
            {(view.status === 'not_suggested' || stale) && (
              <div>
                <Button size="compact" disabled={pending} onClick={onSuggest}>
                  {pending ? t('suggesting') : t(stale ? 'suggestAgain' : 'suggest')}
                </Button>
              </div>
            )}
            {/* Stays mounted so the change of its text is announced. */}
            <output className="sr-only">{pending ? t('suggesting') : ''}</output>
          </>
        )}
      </section>
    </Card>
  );
}
