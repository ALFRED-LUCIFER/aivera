// The scoring core (AIV-P1-030): mapped evidence and an approved rubric in, the backed score, the claim range and a
// level per competency out. Pure and deterministic: no clock, no I/O, the same input always gives the same result.
// AGENTS.md 1.6: a claim counts zero in the backed score; it may only widen the "up to N if claims hold" range.
import type { Provenance, Strength } from '@credalent/evidence';

export type Level = 0 | 1 | 2 | 3 | 4 | 5;

/** A competency of the approved rubric version, by the jobs module's opaque id. Weights total 100. */
export type RubricCompetency = {
  id: string;
  weightPercent: number;
  levelNeeded: number;
  type: 'mandatory' | 'desirable';
};

export type RubricInput = { versionId: string; competencies: readonly RubricCompetency[] };

/**
 * One evidence item linked to one competency, with the level the item shows for it (0–5). Only these fields reach the
 * score: anything else about an item or its source (an "Unusual content in this source" note, the excerpt, the
 * candidate) is not an input, so it cannot act on the candidate (AGENTS.md 1.5).
 */
export type EvidenceLink = {
  itemId: string;
  competencyId: string;
  level: number;
  strength: Strength;
  provenance: Provenance;
};

/**
 * A proven level above 0 always cites at least one item: the type makes an uncited level impossible. An id is an
 * evidence item's or, after an interview-based change (AIV-P1-117), an interview's (`assessment.interview_change.source_id`).
 */
// shortcut: nothing reads the stored changes yet, so a screen cannot tell an interview id from an item id or show the
// change's limit ("the interviewer's word, not inspected work"); AIV-P2-006 (#120) adds that read with the profile's score history.
export type Proven = { level: 0; itemIds: [] } | { level: Exclude<Level, 0>; itemIds: [string, ...string[]] };

export type CompetencyResult = {
  competencyId: string;
  weightPercent: number;
  levelNeeded: number;
  mandatory: boolean;
  proven: Proven;
  /** The level if every claim holds; never below the proven level. */
  claimedLevel: Level;
  /** Items that count only toward the claimed level: claims and unconfirmed signals. Contradicted items count nowhere. */
  claimItemIds: string[];
};

export type Confidence = 'High' | 'Medium' | 'Low';

export type Assessment = {
  rubricVersionId: string;
  /** 0–100: weighted proven levels out of 5. */
  backedScore: number;
  /** 0–100: the same formula with claimed levels ("up to N if claims hold"). */
  upperBound: number;
  /** Competencies whose proven level reaches the level the job needs ("meets the need on X of N"). */
  meetsNeed: number;
  competencyCount: number;
  /** Mandatory competencies proven below the job's need: evidence to request, never a reason to reject. */
  missingCritical: string[];
  confidence: Confidence;
  competencies: CompetencyResult[];
};

const PROVEN_PROVENANCES: readonly Provenance[] = ['corroborated', 'submitted'];

/**
 * Proven: Strong or Medium real work that is not a claim, contradicted or awaiting defence; Supporting only when
 * independently corroborated. Claim-only items never count.
 */
export function counts(link: Pick<EvidenceLink, 'strength' | 'provenance'>): boolean {
  if (link.strength === 'supporting') return link.provenance === 'corroborated';
  return (link.strength === 'strong' || link.strength === 'medium') && PROVEN_PROVENANCES.includes(link.provenance);
}

/** Confidence from the share of the rubric's weight proven by Strong evidence. */
export function confidenceFor(strongShare: number): Confidence {
  if (strongShare >= 0.6) return 'High';
  if (strongShare >= 0.3) return 'Medium';
  return 'Low';
}

const toLevel = (n: number): Level => {
  if (!Number.isInteger(n) || n < 0 || n > 5) throw new RangeError('An evidence level is a whole number from 0 to 5');
  return n as Level;
};

const score = (results: readonly { weightPercent: number; level: number }[]) =>
  Math.round(results.reduce((sum, r) => sum + (r.weightPercent * r.level) / 5, 0));

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Assesses one candidate against one approved rubric version. Links to competencies outside it are ignored. */
export function assess(rubric: RubricInput, links: readonly EvidenceLink[]): Assessment {
  const competencies = rubric.competencies.map((c): CompetencyResult => {
    const own = links.filter((l) => l.competencyId === c.id);
    const proven = own.filter(counts);
    const provenLevel = Math.max(0, ...proven.map((l) => toLevel(l.level))) as Level;
    const cited = proven
      .filter((l) => l.level > 0)
      .map((l) => l.itemId)
      .toSorted(byText);
    // A contradicted item is not a claim that could hold: a second source said otherwise, so it widens nothing.
    const claims = own.filter((l) => !counts(l) && l.provenance !== 'contradictory');
    const claimedLevel = Math.max(provenLevel, ...claims.map((l) => toLevel(l.level))) as Level;
    const [first, ...rest] = cited;
    return {
      competencyId: c.id,
      weightPercent: c.weightPercent,
      levelNeeded: c.levelNeeded,
      mandatory: c.type === 'mandatory',
      proven:
        provenLevel === 0 || first === undefined
          ? { level: 0, itemIds: [] }
          : { level: provenLevel, itemIds: [first, ...rest] },
      claimedLevel,
      claimItemIds: claims.map((l) => l.itemId).toSorted(byText),
    };
  });

  // A competency's weight is Strong-backed only when a Strong item reaches its proven level, not a weaker one beside it.
  const strongWeight = competencies
    .filter(
      (c) =>
        c.proven.level > 0 &&
        links.some(
          (l) =>
            l.competencyId === c.competencyId && l.strength === 'strong' && counts(l) && l.level === c.proven.level,
        ),
    )
    .reduce((sum, c) => sum + c.weightPercent, 0);
  const totalWeight = competencies.reduce((sum, c) => sum + c.weightPercent, 0);

  return {
    rubricVersionId: rubric.versionId,
    backedScore: score(competencies.map((c) => ({ weightPercent: c.weightPercent, level: c.proven.level }))),
    upperBound: score(competencies.map((c) => ({ weightPercent: c.weightPercent, level: c.claimedLevel }))),
    meetsNeed: competencies.filter((c) => c.proven.level >= c.levelNeeded).length,
    competencyCount: competencies.length,
    missingCritical: competencies
      .filter((c) => c.mandatory && c.proven.level < c.levelNeeded)
      .map((c) => c.competencyId),
    confidence: confidenceFor(totalWeight === 0 ? 0 : strongWeight / totalWeight),
    competencies,
  };
}
