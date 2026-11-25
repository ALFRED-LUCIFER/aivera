'use client';

import { useTranslations } from '@credalent/i18n/react';
import { Card, ValueBasis } from '@credalent/ui';
import type { EffectLine, EffectState } from '../domain/scorecard.ts';

// AIV-P2-005: "Effect on the assessment", the Interview artboard's card at the top of the right column
// (docs/01-design/artboards/Interview.dc.html): the empty line, a heading and a strength line per rating, the backed
// score line and "Every change is logged with your name, the time and your note."
// Deviations, each for the ticket, a rule, the data or another component:
// - the numbers are the assessment's own preview (`previewScoreChange`, AIV-P1-117), not the artboard's illustrative
//   ones. Strongly shown adds Medium evidence like Clearly shown, never Strong: one interviewer's word is not a second
//   source (AGENTS.md 1.6, AIV-P1-117), so both read "Supporting to Medium" (55 to 67 in the e2e). Not shown on a
//   claim reads "Supporting to Claim only" and the backed score stays: a claim already counts zero;
// - the heading follows what moved (strength, then proven level), not the rating: a rating that moves nothing, such as
//   Clearly shown beside stronger checked work, reads "No change";
// - every rated competency gets its heading and strength line (the artboard draws one), and the backed score line is
//   one line under them all, with "Before: Observed" and "After: Projection" (AGENTS.md 1.7), as the meeting
//   summary's preview card;
// - the score line is a polite live region, asked for 400 ms after the last rating, so a run of clicks is announced
//   once; "Previewing…" (until the answer for the current ratings arrives) and "Preview unavailable…" are the ticket's
//   and X4's states, which the artboard does not draw;
// - the card is not a named region: the meeting summary's preview card has the same title, and two landmarks of one
//   name fail axe's landmark-unique rule;
// - it shows only to someone who may fill in the scorecard; a read-only viewer submits nothing.
// shortcut: panel copy assumes submit applies (AIV-P2-006, #120); true once #120 merges.

export function ScoreEffect({ state, first }: { state: EffectState; first: string }) {
  const t = useTranslations();
  const strength = (value: EffectLine['to']) =>
    value ? t(`rubric.strength.${value}`) : t('interviewSummary.noEvidence');
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-section text-text">{t('interviewSummary.effect')}</h2>
        {state.status === 'empty' && (
          <p className="text-body text-text-2">{t('scorecard.effect.empty', { name: first })}</p>
        )}
        {state.status === 'pending' && <p className="text-body text-text-2">{t('scorecard.effect.pending')}</p>}
        {state.status === 'ready' &&
          state.lines.map((line) => (
            <div key={line.competencyId} className="flex flex-col gap-1.5">
              <span className="font-semibold text-text">{t(`scorecard.effect.${line.direction}`)}</span>
              <span className="text-body text-text-2">
                {line.from === line.to
                  ? t('scorecard.effect.stays', { name: line.name, strength: strength(line.to) })
                  : t('scorecard.effect.change', { name: line.name, from: strength(line.from), to: strength(line.to) })}
              </span>
            </div>
          ))}
        <div className="flex flex-wrap items-center gap-2">
          {/* Stays mounted so the new score line is announced. */}
          <p aria-live="polite" className="text-body font-semibold text-text tabular-nums">
            {state.status === 'ready'
              ? state.backedScore.from === state.backedScore.to
                ? t('scorecard.effect.scoreStays', { score: state.backedScore.to })
                : t('scorecard.effect.score', state.backedScore)
              : state.status === 'unavailable'
                ? t('scorecard.effect.unavailable')
                : ''}
          </p>
          {state.status === 'ready' && (
            <>
              <ValueBasis basis="observed" label={t('interviewSummary.before')} />
              <ValueBasis basis="projection" label={t('interviewSummary.after')} />
            </>
          )}
        </div>
        <p className="text-meta text-text-2">{t('scorecard.effect.logged')}</p>
      </div>
    </Card>
  );
}
