// The website hero's evidence card: Hessa Al Mazrouei from the synthetic cast (docs/00-product/personas.md).
// Fixed demo values, labelled "Illustrative candidate, synthetic data." on the card; no candidate data is read here.
// Deviation from the Landing artboard ("weight 25%"): 35 is the seeded demo job's weight (tools/seed/src/cast.ts), so the two agree.
export const heroCandidate = { backed: 72, upTo: 85, rank: 1, total: 38, weight: 35 } as const;

/** The design's ease (DESIGN.md motion) as a cubic-bezier tuple for motion/react. */
export const caseEase = [0.16, 1, 0.3, 1] as const;

/** The cited span of `text`, found by its exact words so a reworded message cannot shift the highlight. */
export const citeExact = (text: string, phrase: string, sourceId: string) => {
  const start = text.indexOf(phrase);
  return start < 0 ? [] : [{ start, end: start + phrase.length, sourceId }];
};

/**
 * Whether the card plays its intro (score counting up, bar filling, highlight sweeping). Never under reduced motion.
 * Otherwise only while nobody can see the reset to zero: the card is still below the fold, or still nearly transparent
 * in its own entrance. A card already shown at 72 is never taken back.
 */
export const playsIntro = (o: { reducedMotion: boolean; onScreen: boolean; entranceOpacity: number }) =>
  !o.reducedMotion && (!o.onScreen || o.entranceOpacity < 0.35);
