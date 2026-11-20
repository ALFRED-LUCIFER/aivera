import { describe, expect, it } from 'vitest';
import {
  CLAIM_LIMIT,
  findGaps,
  guardLinks,
  MAX_CHANGES,
  rankChanges,
  sourceText,
  type MapGrade,
  type MapSource,
  type ModelLink,
} from './mapping.ts';
import type { SkillGrade, GradeReason } from './skill-signals/classify.ts';

// AIV-P1-027 post-model guards. Synthetic cast only (docs/00-product/personas.md).

const LLM = 'c-llm';
const RETRIEVAL = 'c-retrieval';
const PYTHON = 'c-python';
const COST = 'c-cost';
const ARABIC = 'c-arabic';
const COMPETENCIES = [LLM, RETRIEVAL, PYTHON, COST, ARABIC];
const STAFF_BACKEND_API = 'c-staff-backend-api-design';

const repo = (over: Partial<MapSource> = {}): MapSource => ({
  id: 'repo',
  kind: 'repository',
  authorship: 'clear',
  declarationSpans: [],
  ...over,
});
const cv: MapSource = { id: 'cv', kind: 'cv', authorship: null, declarationSpans: [] };

const link = (over: Partial<ModelLink> & { quote?: string; sourceId?: string; start?: number } = {}): ModelLink => {
  const { quote = 'authored 412 of 460 commits', sourceId = 'repo', start = 0, ...rest } = over;
  return {
    competencyId: RETRIEVAL,
    strength: 'strong',
    label: 'submitted',
    level: 4,
    limit: 'Shows the tooling, not how results changed product decisions.',
    citations: [{ sourceId, quote, start, end: start + quote.length }],
    ...rest,
  };
};

const grade = (g: SkillGrade, reason: GradeReason, competencyId = PYTHON, sourceId = 'repo'): MapGrade => ({
  sourceId,
  competencyId,
  grade: g,
  reason,
  filesInspected: 120,
});

const strengthFor = (authorship: MapSource['authorship']) =>
  guardLinks({ competencyIds: COMPETENCIES, sources: [repo({ authorship })], grades: [], links: [link()] }).links[0]
    ?.strength;

const guard = (links: ModelLink[], sources: MapSource[] = [repo(), cv], grades: MapGrade[] = []) =>
  guardLinks({ competencyIds: COMPETENCIES, sources, grades, links });

describe('Feature: Evidence mapped to competencies with cited excerpts (AIV-P1-027)', () => {
  it('Scenario: A repository maps to Retrieval and evaluation', () => {
    const { links, discarded } = guard([link()]);
    expect(discarded).toEqual([]);
    expect(links).toEqual([
      {
        competencyId: RETRIEVAL,
        sourceId: 'repo',
        excerpt: 'authored 412 of 460 commits',
        start: 0,
        end: 27,
        strength: 'strong',
        provenance: 'submitted',
        level: 4,
        limit: 'Shows the tooling, not how results changed product decisions.',
        ceiling: 'strong',
      },
    ]);
  });

  // SAFETY: mutation check: remove the claim cap -> "A CV claim is capped" failed
  it('Scenario: A CV claim is capped', () => {
    const [stored] = guard([
      link({ competencyId: COST, sourceId: 'cv', quote: 'cut cost per request by 40%', strength: 'supporting' }),
    ]).links;
    expect(stored).toMatchObject({ strength: 'supporting', provenance: 'claim', limit: CLAIM_LIMIT });
    // A submitted source the model itself labels a claim is capped the same way.
    const [labelled] = guard([link({ label: 'claim', strength: 'strong' })]).links;
    expect(labelled).toMatchObject({ strength: 'supporting', provenance: 'claim', ceiling: 'supporting' });
  });

  // SAFETY: mutation check: lower a CV-sourced Strong to Supporting instead of rejecting it -> "a CV item returned with strength Strong is rejected" failed
  it('Scenario: A CV item returned with strength Strong is rejected', () => {
    const quote = 'Built a document question-answering assistant for an insurance claims team';
    for (const strength of ['strong', 'medium'] as const) {
      const { links, discarded } = guard([link({ competencyId: LLM, sourceId: 'cv', quote, strength })]);
      expect(links).toEqual([]);
      expect(discarded).toEqual([{ competencyId: LLM, reason: 'claim_above_supporting' }]);
    }
  });

  // SAFETY: mutation check: skipped the competency membership check -> "Competencies from another job are refused" failed
  it('Scenario: Competencies from another job are refused', () => {
    const { links, discarded } = guard([link({ competencyId: STAFF_BACKEND_API })]);
    expect(links).toEqual([]);
    expect(discarded).toEqual([{ competencyId: STAFF_BACKEND_API, reason: 'unknown_competency' }]);
  });

  it('never stores "Independently corroborated": only AIV-P1-029 sets it', () => {
    expect(guard([link()]).links.map((l) => l.provenance)).toEqual(['submitted']);
  });

  it('caps a repository by its measured authorship, and an unmeasured one at Medium', () => {
    expect(strengthFor('clear')).toBe('strong');
    expect(strengthFor('shared')).toBe('medium');
    expect(strengthFor('minor')).toBe('supporting');
    expect(strengthFor(null)).toBe('medium');
  });

  // SAFETY: mutation check: removed the declaration cap -> "a link resting only on declarations is capped at Supporting" failed
  it('Scenario: A link resting only on declarations is capped at Supporting', () => {
    // Maria Santos's repository: .py files only under tests/ and requirements.txt; the model over-rates it.
    const { text, declarationSpans } = sourceText(
      'claims-indexer',
      ['authored 96 of 101 commits'],
      [
        {
          skill: 'Python',
          grade: 'PARTIAL',
          reason: 'declaration_only',
          citations: [
            { path: 'requirements.txt', kind: 'manifest', weight: 'declaration', detail: 'declares fastapi' },
            { path: 'tests/test_index.py', kind: 'path', weight: 'declaration', detail: 'Python file under tests/' },
          ],
        },
      ],
    );
    const quote = 'Python in requirements.txt (manifest, declaration): declares fastapi';
    const start = text.indexOf(quote);
    const over = link({ competencyId: PYTHON, quote, start });
    // No grade for the competency here, so only the declaration cap can lower it.
    expect(guard([over], [repo({ declarationSpans })]).links[0]?.strength).toBe('supporting');
    // The commit count line is not a declaration.
    const commits = link({
      competencyId: PYTHON,
      quote: 'authored 96 of 101 commits',
      start: text.indexOf('authored'),
    });
    expect(guard([commits], [repo({ declarationSpans })]).links[0]?.strength).toBe('strong');
  });

  // SAFETY: mutation check: ignored the skill-signal grade -> "the skill-signal grade bounds the strength" failed
  describe('Scenario Outline: the skill-signal grade bounds the strength the model may assign', () => {
    it.each([
      ['STRONG', 'code_corroborated', 'strong'],
      ['PARTIAL', 'single_code_file', 'medium'],
      ['PARTIAL', 'declaration_only', 'supporting'],
    ] as const)('%s (%s) -> strength %s', (g, reason, expected) => {
      const { links } = guard([link({ competencyId: PYTHON })], [repo()], [grade(g, reason)]);
      expect(links.map((l) => l.strength)).toEqual([expected]);
    });

    it.each([
      ['NO_EVIDENCE', 'not_found', 'not_found'],
      ['UNABLE_TO_VERIFY', 'not_detectable', 'unable_to_verify'],
    ] as const)('%s -> no link, and an evidence gap %s', (g, reason, kind) => {
      const grades = [grade(g, reason)];
      const { links, discarded } = guard([link({ competencyId: PYTHON })], [repo()], grades);
      expect(links).toEqual([]);
      expect(discarded).toEqual([{ competencyId: PYTHON, reason: 'no_evidence_grade' }]);
      expect(findGaps(COMPETENCIES, links, grades).find((gap) => gap.competencyId === PYTHON)).toEqual({
        competencyId: PYTHON,
        kind,
        coverage: { filesInspected: 120, reason },
      });
    });

    it('the best grade among the source grades for the competency wins', () => {
      const grades = [grade('NO_EVIDENCE', 'not_found'), grade('PARTIAL', 'single_code_file')];
      expect(guard([link({ competencyId: PYTHON })], [repo()], grades).links[0]?.strength).toBe('medium');
    });
  });

  it('Scenario: The lowest cap wins', () => {
    // Arjun Menon's eval notebook: shared authorship (Medium) and Python graded STRONG (Strong).
    const { links } = guard(
      [link({ competencyId: PYTHON })],
      [repo({ authorship: 'shared' })],
      [grade('STRONG', 'code_files')],
    );
    expect(links.map((l) => [l.strength, l.ceiling])).toEqual([['medium', 'medium']]);
  });

  // SAFETY: mutation check: store NO EVIDENCE as a link with strength claim -> "not found is an evidence gap, never negative evidence" failed
  it('Scenario: Not found is an evidence gap, never negative evidence', () => {
    // Omar Al Suwaidi: Python NO_EVIDENCE, and a separate Retrieval link from the same repository.
    const grades = [grade('NO_EVIDENCE', 'not_found')];
    const model = [link({ competencyId: PYTHON, strength: 'claim' }), link()];
    const { links } = guard(model, [repo()], grades);
    expect(links.filter((l) => l.competencyId === PYTHON)).toEqual([]);
    expect(findGaps(COMPETENCIES, links, grades)).toContainEqual({
      competencyId: PYTHON,
      kind: 'not_found',
      coverage: { filesInspected: 120, reason: 'not_found' },
    });
    // The other competency's link is untouched by the gap.
    expect(links).toEqual(guard([link()], [repo()], []).links);
  });

  it('a competency with no link and no grade is a no_evidence gap with no coverage', () => {
    expect(findGaps([ARABIC], [], [])).toEqual([{ competencyId: ARABIC, kind: 'no_evidence', coverage: null }]);
    expect(findGaps([RETRIEVAL], [{ competencyId: RETRIEVAL }], [])).toEqual([]);
  });

  it('judges a link citing two sources per source: the CV half is a claim, the repository half is not', () => {
    const both: ModelLink = {
      ...link({ competencyId: COST, strength: 'supporting' }),
      citations: [
        { sourceId: 'repo', quote: 'adds a response cache', start: 30, end: 51 },
        { sourceId: 'cv', quote: 'cut cost per request by 40%', start: 0, end: 27 },
      ],
    };
    expect(guard([both]).links.map((l) => [l.sourceId, l.provenance])).toEqual([
      ['repo', 'submitted'],
      ['cv', 'claim'],
    ]);
  });
});

describe('What would change this (AIV-P1-027)', () => {
  const weights = [
    { id: LLM, weight: 30 },
    { id: RETRIEVAL, weight: 25 },
    { id: PYTHON, weight: 20 },
    { id: COST, weight: 15 },
    { id: ARABIC, weight: 10 },
  ];

  it('Scenario: What would change this', () => {
    // Sara: an open claim capped at Supporting on Cost, a gap unable_to_verify on Arabic, a Strong link on Retrieval.
    const links = [
      { competencyId: RETRIEVAL, ceiling: 'strong' as const },
      { competencyId: COST, ceiling: 'supporting' as const },
    ];
    const gaps = [{ competencyId: ARABIC }];
    const { changes, uncited } = rankChanges({
      competencies: weights,
      gaps,
      links,
      suggested: [
        { competencyId: COST, text: 'Ask for the billing dashboard export behind the 40% figure.' },
        { competencyId: ARABIC, text: 'Ask for the Gulf Arabic eval set and its results.' },
        { competencyId: RETRIEVAL, text: 'Already Strong: nothing to close.' },
      ],
    });
    // Cost: 15 x headroom 2 = 30; Arabic: 10 x 3 = 30; ties in rubric order. Retrieval closes nothing: discarded.
    expect(changes).toEqual([
      { competencyId: COST, closes: { link: 1 }, text: 'Ask for the billing dashboard export behind the 40% figure.' },
      { competencyId: ARABIC, closes: { gap: 0 }, text: 'Ask for the Gulf Arabic eval set and its results.' },
    ]);
    expect(uncited).toBe(1);
  });

  // SAFETY: mutation check: stopped counting suggestions that close no gap or capped link -> this test failed
  it('Scenario: An item that cites nothing is discarded', () => {
    const { changes, uncited } = rankChanges({
      competencies: weights,
      gaps: [],
      links: [{ competencyId: RETRIEVAL, ceiling: 'strong' }],
      suggested: [
        { competencyId: RETRIEVAL, text: 'Check her eval harness again.' },
        { competencyId: STAFF_BACKEND_API, text: 'Ask about API design.' },
      ],
    });
    expect(changes).toEqual([]);
    expect(uncited).toBe(2);
  });

  it('keeps at most 3, ordered by weight times headroom, and is empty only when nothing is left to close', () => {
    const gaps = COMPETENCIES.map((competencyId) => ({ competencyId }));
    const { changes } = rankChanges({ competencies: weights, gaps, links: [], suggested: [] });
    expect(changes).toHaveLength(MAX_CHANGES);
    expect(changes.map((c) => c.competencyId)).toEqual([LLM, RETRIEVAL, PYTHON]);
    // Nothing named by the model: the targets stay, with no text, for AIV-P1-038 to word.
    expect(changes.every((c) => c.text === null)).toBe(true);
    // A Medium ceiling on the heaviest competency (30 x 1) ranks below a gap on a lighter one (20 x 3).
    const mixed = rankChanges({
      competencies: weights,
      gaps: [{ competencyId: PYTHON }],
      links: [{ competencyId: LLM, ceiling: 'medium' }],
      suggested: [],
    });
    expect(mixed.changes.map((c) => c.competencyId)).toEqual([PYTHON, LLM]);
  });
});

describe('sourceText', () => {
  it('lists the label, the excerpts and each grade with its citations, marking declaration lines', () => {
    const { text, declarationSpans } = sourceText(
      'llm-eval-harness',
      ['authored 412 of 460 commits'],
      [
        {
          skill: 'Python',
          grade: 'STRONG',
          reason: 'code_corroborated',
          citations: [
            { path: 'src/eval/run.py', kind: 'path', weight: 'code', detail: 'Python source file' },
            { path: 'pyproject.toml', kind: 'manifest', weight: 'declaration', detail: 'declares pytest' },
          ],
        },
      ],
    );
    expect(text).toBe(
      [
        'llm-eval-harness',
        'authored 412 of 460 commits',
        'Skill signal Python: STRONG (code_corroborated)',
        'Python in src/eval/run.py (path, code): Python source file',
        'Python in pyproject.toml (manifest, declaration): declares pytest',
      ].join('\n'),
    );
    expect(declarationSpans.map((s) => text.slice(s.start, s.end))).toEqual([
      'Python in pyproject.toml (manifest, declaration): declares pytest',
    ]);
  });
});
