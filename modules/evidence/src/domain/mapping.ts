// Evidence mapped to a job's competencies (AIV-P1-027): the deterministic guards after the model. Pure. The model only
// suggests a strength; these rules decide what is stored, and the lowest applicable cap wins. A gap is never negative
// evidence: it lowers nothing and is never a reason to reject (AGENTS.md 1.6).
import { STRENGTH_CAP, type AuthorshipClass } from './repository.ts';
import type { Provenance, SourceKind, Strength } from './evidence.ts';
import type { Citation, GradeReason, SkillGrade } from './skill-signals/classify.ts';

const RANK: Record<Strength, number> = { claim: 0, supporting: 1, medium: 2, strong: 3 };
const lowest = (...strengths: Strength[]) =>
  strengths.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), 'strong' as Strength);

export const CLAIM_LIMIT = 'A claim until a document or a second source supports it.';

/** One of the candidate's sources as the model saw it. */
export type MapSource = {
  id: string;
  kind: SourceKind;
  /** The repository read's authorship class; null when nothing was measured (or not a repository). */
  authorship: AuthorshipClass | null;
  /** Spans of the text the model saw that are declaration-level skill signals only (a manifest, a README, tests/). */
  declarationSpans: { start: number; end: number }[];
};

/** A repository source's skill grade for one competency of the rubric version (AIV-P1-072). */
export type MapGrade = {
  sourceId: string;
  competencyId: string;
  grade: SkillGrade;
  reason: GradeReason;
  filesInspected: number;
};

/** One link the model suggested, after the citation contract checked its quotes. */
export type ModelLink = {
  competencyId: string;
  strength: Strength;
  label: 'submitted' | 'claim';
  level: number;
  limit: string;
  citations: { sourceId: string; quote: string; start: number; end: number }[];
};

export type MappedLink = {
  competencyId: string;
  sourceId: string;
  excerpt: string;
  start: number;
  end: number;
  strength: Strength;
  provenance: Provenance;
  level: number;
  limit: string;
  /** The lowest cap the guards found; below Strong, the link has headroom "What would change this" can name. */
  ceiling: Strength;
};

/** Why a suggested link was not stored. `claim_above_supporting` and `unknown_competency` are guard failures. */
export type DiscardReason = 'unknown_competency' | 'unknown_source' | 'claim_above_supporting' | 'no_evidence_grade';

/** A skill grade's ceiling (the ticket's table); null for NO_EVIDENCE and UNABLE_TO_VERIFY: no link, a gap. */
export function gradeCap(grade: SkillGrade, reason: GradeReason): Strength | null {
  if (grade === 'STRONG') return 'strong';
  if (grade === 'PARTIAL') return reason === 'single_code_file' ? 'medium' : 'supporting';
  return null;
}

const within = (spans: readonly { start: number; end: number }[], start: number, end: number) =>
  spans.some((s) => s.start <= start && end <= s.end);

/**
 * The guards, per cited span (a link citing two sources is two links, each judged by its own source): competency
 * membership; a CV-sourced link above Supporting rejected, never lowered; a claim capped at Supporting; authorship,
 * skill-signal and declaration caps on repositories; and never "Independently corroborated", which only AIV-P1-029 sets.
 */
export function guardLinks(input: {
  competencyIds: readonly string[];
  sources: readonly MapSource[];
  grades: readonly MapGrade[];
  links: readonly ModelLink[];
}): { links: MappedLink[]; discarded: { competencyId: string; reason: DiscardReason }[] } {
  const sources = new Map(input.sources.map((s) => [s.id, s]));
  const kept: MappedLink[] = [];
  const discarded: { competencyId: string; reason: DiscardReason }[] = [];
  for (const link of input.links)
    for (const citation of link.citations) {
      const discard = (reason: DiscardReason) => discarded.push({ competencyId: link.competencyId, reason });
      if (!input.competencyIds.includes(link.competencyId)) {
        discard('unknown_competency');
        continue;
      }
      const source = sources.get(citation.sourceId);
      if (!source) {
        discard('unknown_source');
        continue;
      }
      const cv = source.kind === 'cv';
      // The model has no reason to rate a CV line above Supporting unless it obeyed text in the CV.
      if (cv && RANK[link.strength] > RANK.supporting) {
        discard('claim_above_supporting');
        continue;
      }
      const claim = cv || link.label === 'claim';
      const caps: Strength[] = claim ? ['supporting'] : [];
      if (source.kind === 'repository') {
        // Unmeasured authorship (a merged pull request's upstream) is "authorship unclear": Medium at most.
        caps.push(source.authorship ? STRENGTH_CAP[source.authorship] : 'medium');
        const grades = input.grades.filter((g) => g.sourceId === source.id && g.competencyId === link.competencyId);
        if (grades.length) {
          const best = grades.map((g) => gradeCap(g.grade, g.reason)).filter((c): c is Strength => c !== null);
          if (!best.length) {
            discard('no_evidence_grade');
            continue;
          }
          caps.push(best.reduce((a, b) => (RANK[b] > RANK[a] ? b : a)));
        }
        if (within(source.declarationSpans, citation.start, citation.end)) caps.push('supporting');
      }
      const ceiling = lowest(...caps);
      const duplicate = kept.some(
        (k) => k.competencyId === link.competencyId && k.sourceId === source.id && k.start === citation.start,
      );
      if (duplicate) continue;
      kept.push({
        competencyId: link.competencyId,
        sourceId: source.id,
        excerpt: citation.quote,
        start: citation.start,
        end: citation.end,
        strength: lowest(link.strength, ceiling),
        provenance: claim ? 'claim' : 'submitted',
        level: link.level,
        limit: cv ? CLAIM_LIMIT : link.limit,
        ceiling,
      });
    }
  return { links: kept, discarded };
}

export const GAP_KINDS = ['not_found', 'unable_to_verify', 'no_evidence'] as const;
export type GapKind = (typeof GAP_KINDS)[number];

/** A competency nothing backs for the rubric version: evidence to request, never negative evidence. */
export type EvidenceGap = {
  competencyId: string;
  kind: GapKind;
  /** The repository scan's coverage behind the kind; null for `no_evidence`. */
  coverage: { filesInspected: number; reason: GradeReason } | null;
};

/**
 * Every rubric competency with no stored link is a gap: `unable_to_verify` when a repository could not check it,
 * `not_found` when a complete scan found nothing, otherwise `no_evidence`.
 */
export function findGaps(
  competencyIds: readonly string[],
  links: readonly Pick<MappedLink, 'competencyId'>[],
  grades: readonly MapGrade[],
): EvidenceGap[] {
  return competencyIds
    .filter((id) => !links.some((l) => l.competencyId === id))
    .map((competencyId) => {
      const own = grades.filter((g) => g.competencyId === competencyId);
      const grade =
        own.find((g) => g.grade === 'UNABLE_TO_VERIFY') ?? own.find((g) => g.grade === 'NO_EVIDENCE') ?? null;
      if (!grade) return { competencyId, kind: 'no_evidence', coverage: null };
      return {
        competencyId,
        kind: grade.grade === 'UNABLE_TO_VERIFY' ? 'unable_to_verify' : 'not_found',
        coverage: { filesInspected: grade.filesInspected, reason: grade.reason },
      };
    });
}

export const MAX_CHANGES = 3;

/** What one "What would change this" item closes: a gap or a capped link, by its index in the stored lists. */
export type ChangeTarget = { gap: number } | { link: number };

/** A stored "What would change this" item: the gap or the capped item it closes, by id. */
export type StoredChange = {
  competencyId: string;
  closes: { gapId: string } | { itemId: string };
  text: string | null;
};

/**
 * "What would change this": up to 3 checks, each closing a gap or a capped link (ceiling below Strong) of a rubric
 * competency. The model's items that close nothing are discarded (counted as citation failures). Ordered by
 * competency weight times headroom (how far the cap sits below Strong), ties in rubric order. Empty only when nothing
 * is left to close: a target the model named no check for is kept with `text: null`, for AIV-P1-038 to word.
 */
export function rankChanges(input: {
  competencies: readonly { id: string; weight: number }[];
  gaps: readonly Pick<EvidenceGap, 'competencyId'>[];
  links: readonly Pick<MappedLink, 'competencyId' | 'ceiling'>[];
  suggested: readonly { competencyId: string; text: string }[];
}): { changes: { competencyId: string; closes: ChangeTarget; text: string | null }[]; uncited: number } {
  const order = (id: string) => input.competencies.findIndex((c) => c.id === id);
  const weight = (id: string) => input.competencies[order(id)]?.weight ?? 0;
  const targets = input.competencies.flatMap(({ id }) => {
    const gap = input.gaps.findIndex((g) => g.competencyId === id);
    if (gap >= 0) return [{ competencyId: id, closes: { gap } as ChangeTarget, score: weight(id) * RANK.strong }];
    const capped = input.links
      .map((l, i) => ({ ...l, i }))
      .filter((l) => l.competencyId === id && RANK[l.ceiling] < RANK.strong)
      .toSorted((a, b) => RANK[a.ceiling] - RANK[b.ceiling])[0];
    return capped
      ? [
          {
            competencyId: id,
            closes: { link: capped.i } as ChangeTarget,
            score: weight(id) * (3 - RANK[capped.ceiling]),
          },
        ]
      : [];
  });
  const texts = new Map<string, string>();
  let uncited = 0;
  for (const s of input.suggested)
    if (!targets.some((t) => t.competencyId === s.competencyId)) uncited++;
    else if (!texts.has(s.competencyId)) texts.set(s.competencyId, s.text);
  const changes = targets
    .toSorted((a, b) => b.score - a.score || order(a.competencyId) - order(b.competencyId))
    .slice(0, MAX_CHANGES)
    .map(({ competencyId, closes }) => ({ competencyId, closes, text: texts.get(competencyId) ?? null }));
  return { changes, uncited };
}

/**
 * The text the model sees for one source: its label, its items' excerpts, then a repository's skill grades and their
 * file citations as measured facts, one per line. Returns the spans of the declaration-level citation lines.
 */
export function sourceText(
  label: string,
  excerpts: readonly string[],
  grades: readonly { skill: string; grade: SkillGrade; reason: GradeReason; citations: readonly Citation[] }[],
): { text: string; declarationSpans: { start: number; end: number }[] } {
  let text = [label, ...excerpts].join('\n');
  const declarationSpans: { start: number; end: number }[] = [];
  const line = (value: string, declaration: boolean) => {
    text += '\n';
    if (declaration) declarationSpans.push({ start: text.length, end: text.length + value.length });
    text += value;
  };
  // One grade per skill: a skill two competencies share is graded the same against the same signals.
  for (const g of new Map(grades.map((one) => [one.skill, one])).values()) {
    line(`Skill signal ${g.skill}: ${g.grade} (${g.reason})`, false);
    for (const c of g.citations)
      line(`${g.skill} in ${c.path} (${c.kind}, ${c.weight}): ${c.detail}`, c.weight === 'declaration');
  }
  return { text, declarationSpans };
}
