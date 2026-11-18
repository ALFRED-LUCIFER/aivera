// The website hero's evidence card: Hessa Al Mazrouei from the synthetic cast (docs/00-product/personas.md).
// Fixed demo values, labelled "Illustrative candidate, synthetic data." on the card; no candidate data is read here.
export const heroCandidate = { backed: 72, upTo: 85, rank: 1, total: 38, weight: 25 } as const;

/** The design's ease (DESIGN.md motion) as a cubic-bezier tuple for motion/react. */
export const caseEase = [0.16, 1, 0.3, 1] as const;

/** The cited span of `text`, found by its exact words so a reworded message cannot shift the highlight. */
export const citeExact = (text: string, phrase: string, sourceId: string) => {
  const start = text.indexOf(phrase);
  return start < 0 ? [] : [{ start, end: start + phrase.length, sourceId }];
};

/**
 * Whether the card plays its intro (score counting up, bar filling, highlight sweeping). Never under reduced motion,
 * and not when the card is already on screen once the page has settled: replaying it would flash the final state away.
 */
export const playsIntro = (o: { reducedMotion: boolean; onScreen: boolean; msSinceStart: number }) =>
  !o.reducedMotion && !(o.onScreen && o.msSinceStart > 900);
