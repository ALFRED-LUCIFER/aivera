import type { CompetencyResult } from '@credalent/assessment';

// "Against what the job needs" (AIV-P1-044): each competency's proven and claimed level against the level the job
// needs. Pure. The verdict of one row ("Above the need", "1 short, claimed") is the shared NeedVsProvenBar's
// (@credalent/ui); this file shapes the rows and counts them.

export type NeedRow = { competencyId: string; name: string; proven: number; claimed: number; needed: number };

/**
 * One row per competency of the stored assessment, heaviest first (the order of "Competency by competency"). `names`
 * are the approved rubric's competency names by id; a competency it does not name gets no row.
 */
export const needRows = (results: readonly CompetencyResult[], names: ReadonlyMap<string, string>): NeedRow[] =>
  results
    .toSorted((a, b) => b.weightPercent - a.weightPercent)
    .flatMap((r) => {
      const name = names.get(r.competencyId);
      return name === undefined
        ? []
        : {
            competencyId: r.competencyId,
            name,
            proven: r.proven.level,
            claimed: r.claimedLevel,
            needed: r.levelNeeded,
          };
    });

/**
 * "Meets the need on 4 of 6 competencies" and the footnote's "The two gaps would close if their claims hold". A
 * claim counts zero toward meeting the need (AGENTS.md 1.6): a gap only "would close" when the claimed level reaches it.
 */
export function needSummary(rows: readonly NeedRow[]): { meets: number; gaps: number; closing: number } {
  const gaps = rows.filter((r) => r.proven < r.needed);
  return {
    meets: rows.length - gaps.length,
    gaps: gaps.length,
    closing: gaps.filter((r) => r.claimed >= r.needed).length,
  };
}

/** The radar's geometry, as the Candidate artboard draws it: a 540 by 340 box, level 5 at 110 from the centre. */
export const RADAR = { width: 540, height: 340, cx: 270, cy: 170, r: 110, levels: 5 } as const;

const round = (v: number) => Math.round(v * 10) / 10;

/** The point on axis `i` of `n` at `distance` from the centre; axis 0 points up and the axes run clockwise. */
export function radarPoint(i: number, n: number, distance: number): [x: number, y: number] {
  const angle = (2 * Math.PI * i) / n;
  return [round(RADAR.cx + distance * Math.sin(angle)), round(RADAR.cy - distance * Math.cos(angle))];
}

/** The SVG `points` of the shape that joins one level per axis: "270,60 365.3,115 …". */
export const radarShape = (levels: readonly number[]): string =>
  levels.map((level, i) => radarPoint(i, levels.length, (level / RADAR.levels) * RADAR.r).join(',')).join(' ');
