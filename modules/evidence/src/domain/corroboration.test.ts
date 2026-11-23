import { describe, expect, it } from 'vitest';
import {
  corroboratedCompetencies,
  isIndependent,
  pairKey,
  comparablePairs,
  shownAs,
  type Comparison,
  type OriginSource,
  type RuleLink,
} from './corroboration.ts';

// AIV-P1-029, synthetic cast only (docs/00-product/personas.md).
const DISTRIBUTED = 'distributed-systems';
const LOGINS = ['arjun-menon-example'];

const source = (id: string, over: Partial<OriginSource> = {}): OriginSource => ({
  id,
  kind: 'document',
  commitHistory: false,
  pullRequests: [],
  ...over,
});
const SOURCES: Record<string, OriginSource> = {
  'candidate write-up': source('write-up'),
  'CV line': source('cv', { kind: 'cv' }),
  'personal blog post': source('blog', { kind: 'portal_submission' }),
  'reference call': source('reference', { kind: 'reference_call' }),
  'commit history': source('commits', { kind: 'repository', commitHistory: true }),
  'pull request merged by another maintainer': source('pr-other', {
    kind: 'repository',
    pullRequests: [{ repository: 'queue-org/queue', mergedBy: 'maintainer-b', selfMerged: false }],
  }),
  'self-merged pull request': source('pr-self', {
    kind: 'repository',
    pullRequests: [{ repository: 'queue-org/queue', mergedBy: 'arjun-menon-example', selfMerged: true }],
  }),
  "pull request into the candidate's own repository": source('pr-own', {
    kind: 'repository',
    pullRequests: [{ repository: 'arjun-menon-example/queue', mergedBy: 'maintainer-b', selfMerged: false }],
  }),
};

const link = (sourceId: string, provenance: RuleLink['provenance'] = 'submitted'): RuleLink => ({
  competencyId: DISTRIBUTED,
  sourceId,
  provenance,
});
const evaluate = (sources: OriginSource[], originGroups: string[][] = []) =>
  corroboratedCompetencies({ links: sources.map((s) => link(s.id)), sources, originGroups, logins: LOGINS }).has(
    DISTRIBUTED,
  )
    ? 'Independently corroborated'
    : 'Candidate-submitted';

const excerptLink = (sourceId: string, excerpt: string, competencyId = DISTRIBUTED) => ({
  ...link(sourceId),
  competencyId,
  excerpt,
});
const contradiction = (over: Partial<Comparison>): Comparison => ({
  id: 'c1',
  workspaceId: 'w',
  candidateId: 'c',
  jobId: 'j',
  mappingId: 'm',
  competencyId: DISTRIBUTED,
  itemId: 'i1',
  otherItemId: 'i2',
  outcome: 'contradiction',
  method: 'numeric_precheck',
  resolvedBy: null,
  resolvedAt: null,
  resolutionNote: null,
  resolutionLimit: null,
  resolutionStandingSourceId: null,
  createdAt: new Date('2026-11-20T09:00:00Z'),
  ...over,
});

describe('corroboratedCompetencies', () => {
  // SAFETY: mutation check: let two candidate-authored origins corroborate (dropped the independent-origin condition) -> "CV line + personal blog post" row failed
  it.each([
    ['candidate write-up', 'reference call', 'Independently corroborated'],
    ['candidate write-up', 'commit history', 'Independently corroborated'],
    ['candidate write-up', 'pull request merged by another maintainer', 'Independently corroborated'],
    ['candidate write-up', 'self-merged pull request', 'Candidate-submitted'],
    ['candidate write-up', "pull request into the candidate's own repository", 'Candidate-submitted'],
    ['CV line', 'personal blog post', 'Candidate-submitted'],
    ['reference call', 'commit history', 'Independently corroborated'],
  ])('a "%s" and a "%s" source: %s', (first, second, provenance) => {
    expect(evaluate([SOURCES[first] as OriginSource, SOURCES[second] as OriginSource])).toBe(provenance);
  });

  // SAFETY: mutation check: let self-merged PRs corroborate (dropped `!pr.selfMerged` and the merger-login check) -> merged-PR rule test failed
  it.each([
    ['maintainer-b', 'queue-org', 'Independently corroborated'],
    ['arjun-menon-example', 'queue-org', 'Candidate-submitted'],
    ['maintainer-b', 'arjun-menon-example', 'Candidate-submitted'],
    ['arjun-menon-example', 'arjun-menon-example', 'Candidate-submitted'],
    // GitHub no longer names the merger: nobody can be shown to have judged the work.
    [null, 'queue-org', 'Candidate-submitted'],
  ])('merged-PR rule: a pull request merged by %s into a repository owned by %s is %s', (merger, owner, provenance) => {
    const pr = source('pr', {
      kind: 'repository',
      pullRequests: [
        {
          repository: `${owner}/queue`,
          mergedBy: merger,
          // As the repository read records it: merged by the login the candidate supplied.
          selfMerged: merger === 'arjun-menon-example',
        },
      ],
    });
    expect(evaluate([source('write-up'), pr])).toBe(provenance);
  });

  it('a self-merge is caught by the login even when the read did not flag it, case-insensitively', () => {
    const pr = source('pr', {
      kind: 'repository',
      pullRequests: [{ repository: 'queue-org/queue', mergedBy: 'Arjun-Menon-Example', selfMerged: false }],
    });
    expect(isIndependent(pr, LOGINS)).toBe(false);
  });

  it('an upstream repository where the candidate self-merged once is not independent for any of its pull requests', () => {
    const pr = source('pr', {
      kind: 'repository',
      pullRequests: [
        { repository: 'queue-org/queue', mergedBy: 'maintainer-b', selfMerged: false },
        { repository: 'queue-org/queue', mergedBy: 'arjun-menon-example', selfMerged: true },
      ],
    });
    expect(isIndependent(pr, LOGINS)).toBe(false);
  });

  // SAFETY: mutation check: let near-duplicate sources corroborate (counted origins by source id, ignoring originGroups) -> duplicate-source guard test failed
  it('duplicate-source guard: a near-duplicate pair under different kinds and titles is one origin and stays Candidate-submitted', () => {
    // Sara's write-up as a document, and the same text, lightly edited, as a portal submission; AIV-P1-071 groups them.
    // The reference call notes were copied from it too, so even the reference is the same origin.
    const document = source('doc');
    const portal = source('portal', { kind: 'portal_submission' });
    const copiedReference = source('reference', { kind: 'reference_call' });
    // The assertion that bites: a copied reference would corroborate if grouping were ignored.
    expect(evaluate([document, copiedReference], [['doc', 'reference']])).toBe('Candidate-submitted');
    expect(evaluate([document, copiedReference], [['doc'], ['reference']])).toBe('Independently corroborated');
    expect(evaluate([document, portal], [['doc', 'portal']])).toBe('Candidate-submitted');
  });

  it('a single independent source, claims and other competencies do not corroborate', () => {
    expect(evaluate([source('reference', { kind: 'reference_call' })])).toBe('Candidate-submitted');
    const sources = [source('write-up'), source('reference', { kind: 'reference_call' })];
    const asClaim = corroboratedCompetencies({
      links: [link('write-up', 'claim'), link('reference')],
      sources,
      originGroups: [],
      logins: LOGINS,
    });
    expect(asClaim.size).toBe(0);
    const split = corroboratedCompetencies({
      links: [link('write-up'), { ...link('reference'), competencyId: 'other' }],
      sources,
      originGroups: [],
      logins: LOGINS,
    });
    expect(split.size).toBe(0);
  });

  // SAFETY: mutation check: ignored `withheld` in corroboratedCompetencies -> this test failed
  it('a source in an open contradiction vouches for nothing', () => {
    const sources = [source('write-up'), source('write-up-2'), source('reference', { kind: 'reference_call' })];
    const links = [link('write-up'), link('write-up-2'), link('reference')];
    expect(corroboratedCompetencies({ links, sources, originGroups: [], logins: LOGINS }).size).toBe(1);
    const withheld = new Set(['write-up', 'reference']);
    expect(corroboratedCompetencies({ links, sources, originGroups: [], logins: LOGINS, withheld }).size).toBe(0);
  });

  it('an unread repository and an interview note are not independent', () => {
    expect(isIndependent(source('repo', { kind: 'repository' }), LOGINS)).toBe(false);
    expect(isIndependent(source('note', { kind: 'interview_note' }), LOGINS)).toBe(false);
  });
});

describe('comparablePairs', () => {
  it('flags a scoped number that differs, records a match as agreement, leaves worded numbers to the AI comparison', () => {
    const links = [
      excerptLink('write-up', 'led a team of 12 engineers'),
      excerptLink('reference', 'managed 5 engineers'),
      excerptLink('scorecard', 'ran a 12-person team'),
      excerptLink('blog', 'about 9,000 merchants use the assistant'),
      excerptLink('call', 'a few hundred merchants'),
    ];
    expect(comparablePairs(links, [])).toEqual([
      { a: 0, b: 1, outcome: 'contradiction' },
      { a: 0, b: 2, outcome: 'agreement' },
      { a: 1, b: 2, outcome: 'contradiction' },
      { a: 3, b: 4, outcome: 'not_settled' },
    ]);
  });

  it('never compares one origin with itself or across competencies', () => {
    const links = [
      excerptLink('doc', 'led a team of 12 engineers'),
      excerptLink('portal', 'led a team of 5 engineers'),
      excerptLink('reference', 'managed 5 engineers', 'other'),
    ];
    expect(comparablePairs(links, [['doc', 'portal']])).toEqual([]);
  });
});

const resolvedWith = (standing: string | null) =>
  contradiction({
    resolvedBy: 'u',
    resolvedAt: new Date('2026-11-21T09:00:00Z'),
    resolutionNote: 'The repository shows the work',
    resolutionLimit: 'The CV overstated the scale.',
    resolutionStandingSourceId: standing,
  });

describe('shownAs and pairKey', () => {
  const item = { id: 'i1', sourceId: 's1', provenance: 'corroborated' as const, limit: 'Own limit.' };
  // SAFETY: mutation check: returned the item's own provenance for an open contradiction -> this test failed
  it('an open contradiction shows "Contradictory"; a resolved one shows its own provenance and the resolution limit', () => {
    expect(shownAs(item, [contradiction({})])).toEqual({ provenance: 'contradictory', limit: 'Own limit.' });
    const resolved = contradiction({
      resolvedBy: 'u',
      resolvedAt: new Date('2026-11-21T09:00:00Z'),
      resolutionNote: 'Reference confirmed scale only roughly',
      resolutionLimit: 'The reference confirmed the scale only roughly.',
    });
    expect(shownAs(item, [resolved])).toEqual({
      provenance: 'corroborated',
      limit: 'The reference confirmed the scale only roughly.',
    });
    expect(shownAs(item, [contradiction({ outcome: 'agreement' })])).toEqual({
      provenance: 'corroborated',
      limit: 'Own limit.',
    });
  });

  // SAFETY: mutation check: ignored the standing source in shownAs -> this test failed
  it('Scenario: Resolving a contradiction is a recorded decision: the source set aside stays "Contradictory" (AIV-P2-063)', () => {
    const limit = 'The CV overstated the scale.';
    expect(shownAs(item, [resolvedWith('s1')])).toEqual({ provenance: 'corroborated', limit });
    expect(shownAs(item, [resolvedWith('s2')])).toEqual({ provenance: 'contradictory', limit });
    expect(shownAs(item, [resolvedWith(null)])).toEqual({ provenance: 'corroborated', limit });
  });

  it('pairs two excerpts the same way in either order', () => {
    const a = { sourceId: 's1', excerpt: 'led a team of 12 engineers' };
    const b = { sourceId: 's2', excerpt: 'managed 5 engineers' };
    expect(pairKey(a, b)).toBe(pairKey(b, a));
    expect(pairKey(a, b)).not.toBe(pairKey(a, { ...b, excerpt: 'managed 6 engineers' }));
  });
});
