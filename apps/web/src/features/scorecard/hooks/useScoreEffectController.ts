import { assessedRatings, type ScorecardDraft } from '@credalent/interviews';
import { useEffect, useState } from 'react';
import {
  effectLines,
  type EffectState,
  type PreviewRatings,
  type EffectPreview,
  type ScorecardData,
} from '../domain/scorecard.ts';
import { previewScorecardRatings } from '../services/previewEffect.ts';

/** How long after the last rating the preview is asked for, so a run of clicks is previewed and announced once. */
const DEBOUNCE_MS = 400;

/**
 * "Effect on the assessment" (AIV-P2-005): the assessment's preview of the draft's ratings, asked for a moment after
 * they change. Nothing here writes: the preview is a read, and the draft saves itself through the scorecard's own
 * controller. Until the answer for the current ratings arrives the panel says "Previewing…", never an earlier
 * rating's answer; an older answer never replaces a newer one.
 */
export function useScoreEffectController(data: ScorecardData, draft: ScorecardDraft): EffectState {
  // Only someone who may submit sees the panel; a competency not assessed carries no rating (`assessedRatings`).
  const rated: PreviewRatings = data.canEdit
    ? assessedRatings(draft).map(({ competencyId, rating }) => ({ competencyId, rating }))
    : [];
  // The ratings as a string: typing a note changes the draft, not what is previewed. A new snapshot (the page refreshed
  // after "preview again", AIV-P2-006) is previewed afresh, whatever the ratings.
  const key = JSON.stringify([rated, data.assessed?.at ?? null]);
  const [shown, setShown] = useState<{ key: string; effect: EffectPreview | null } | null>(null);
  const { interviewId } = data;

  useEffect(() => {
    // From the key, so the effect depends on what is previewed, not on a new array each render.
    const [ratings] = JSON.parse(key) as [PreviewRatings];
    if (ratings.length === 0) return;
    let current = true;
    const timer = setTimeout(() => {
      void previewScorecardRatings({ interviewId, ratings })
        .catch(() => null)
        .then((effect) => current && setShown({ key, effect }));
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [interviewId, key]);

  if (rated.length === 0) return { status: 'empty' };
  if (shown?.key !== key) return { status: 'pending' };
  if (!shown.effect) return { status: 'unavailable' };
  return {
    status: 'ready',
    lines: effectLines(rated, shown.effect, data.competencies),
    backedScore: shown.effect.backedScore,
    previewId: shown.effect.previewId,
  };
}
