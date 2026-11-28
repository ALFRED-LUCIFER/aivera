import type { CandidateRow } from './ranking.ts';

/**
 * The rule that really ordered the rows (AIV-P1-165 §9). Assessment ranks by backed score, then by "up to N", then by
 * who was assessed first. A claim counts zero (AGENTS.md 1.6, owner decision (a)), so when every assessed candidate's
 * backed score is 0 the order rests on claims alone and the page must say so. 'none' while nobody is assessed.
 */
export function orderBasis(rows: readonly CandidateRow[]): 'backed' | 'claims' | 'none' {
  const scored = rows.flatMap((row) => (row.score ? [row.score] : []));
  if (scored.length === 0) return 'none';
  return scored.every((score) => score.backedScore === 0) ? 'claims' : 'backed';
}
