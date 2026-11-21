import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packForJobType, type CatalogueVersion } from '@credalent/jobs';
import { describe, expect, it } from 'vitest';
import {
  CANDIDATES,
  EVIDENCE,
  HIRING_OWNERS,
  INDUSTRY_JOBS,
  industryRubric,
  JOBS,
  RECRUITER,
  WORKSPACE,
} from './cast.ts';

const people = [RECRUITER, ...HIRING_OWNERS, ...CANDIDATES];
// Catalogue version 1 from its committed snapshot, as migration 0012 publishes it.
const v1: CatalogueVersion = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../modules/jobs/src/infrastructure/catalogue-v1.json'), 'utf8'),
);
const jobTypeKeys = v1.jobTypes.map((t) => t.key);

describe('the demo cast (AIV-P0-031)', () => {
  it('marks the workspace and every person synthetic, on example.com and the drama phone range', () => {
    expect(WORKSPACE.synthetic).toBe(true);
    for (const p of people) {
      expect(p.synthetic).toBe(true);
      expect(p.email).toMatch(/^[a-z.]+@example\.com$/);
    }
    for (const c of CANDIDATES) expect(c.phone).toMatch(/^\+447700900\d{3}$/);
  });

  it('holds the 23 candidates of the design, each with their own email and phone', () => {
    expect(CANDIDATES).toHaveLength(23);
    const names = CANDIDATES.map((c) => c.displayName);
    expect(names).toEqual(expect.arrayContaining(['Sara Al Qahtani', 'Arjun Menon', 'Layla Haddad', 'Daniel Novak']));
    expect(CANDIDATES.find((c) => c.displayName === 'Sara Al Qahtani')?.email).toBe('sara.alqahtani@example.com');
    expect(new Set(people.map((p) => p.email)).size).toBe(people.length);
    expect(new Set(CANDIDATES.map((c) => c.phone)).size).toBe(CANDIDATES.length);
  });

  it('has the five jobs of the design, each owned by a hiring owner, with weights totalling 100', () => {
    expect(HIRING_OWNERS).toHaveLength(5);
    expect(JOBS.map((j) => j.title)).toEqual([
      'Senior AI Engineer',
      'Senior Product Manager, Payments',
      'QA Automation Engineer',
      'Staff Backend Engineer',
      'Senior Product Designer',
    ]);
    for (const job of JOBS) {
      expect(jobTypeKeys).toContain(job.jobType);
      expect(HIRING_OWNERS.map((o) => o.key)).toContain(job.hiringOwner);
      expect(job.rubric.competencies.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
    }
  });

  it('matches the design: AI Engineer rubric v2 approved by its hiring owner on 12 Nov 2026; Designer a draft', () => {
    const ai = JOBS.find((j) => j.title === 'Senior AI Engineer');
    expect(ai).toMatchObject({ hiringOwner: 'head.engineering', location: 'DIFC, Dubai' });
    expect(ai?.rubric).toMatchObject({ version: 2, approvedOn: '2026-11-12' });
    expect(ai?.rubric.competencies.map((c) => c.weight)).toEqual([25, 20, 15, 15, 10, 15]);
    expect(JOBS.find((j) => j.title === 'Staff Backend Engineer')?.location).toBe('Riyadh, hybrid');
    expect(JOBS.find((j) => j.title === 'Senior Product Designer')).toMatchObject({
      stage: 'defining_rubric',
      rubric: { approvedOn: null },
    });
  });
});

describe('the industry demo jobs (AIV-P1-065)', () => {
  it('leaves the five design jobs exactly as they are', () => {
    expect(JOBS).toMatchSnapshot();
  });

  it.each([
    ['Senior Backend Engineer, Payments', 'payments_fintech', 'uae'],
    ['Integration Engineer, Health Records', 'healthcare', 'uae'],
    ['Data Engineer, Marketplace', 'ecommerce_marketplaces', 'ksa'],
    ['SRE, Core Banking', 'banking_islamic_finance', 'ksa'],
    ['QA Engineer, Payments', 'payments_fintech', 'india'],
  ])('%s holds every core competency of %s and its %s hints, recording the pack', (title, key, region) => {
    const job = INDUSTRY_JOBS.find((j) => j.title === title);
    if (!job) throw new Error(`no cast job ${title}`);
    expect([job.pack, job.region]).toEqual([key, region]);
    const pack = packForJobType(v1, job.pack, job.jobType);
    const hints = pack?.hints.filter((h) => h.region === job.region) ?? [];
    const rubric = industryRubric(job, v1);
    const packed = rubric.filter((c) => c.origin === 'domain_pack');
    expect(pack?.core.length).toBeGreaterThan(0);
    expect(hints.length).toBeGreaterThan(0);
    expect(packed.map((c) => c.name)).toEqual([...(pack?.core ?? []), ...hints].map((c) => c.name));
    for (const c of packed) expect(c).toMatchObject({ packKey: key, packVersion: 1 });
    expect(rubric.filter((c) => c.origin === 'added_by_recruiter')).toHaveLength(4);
  });

  it('has valid job types, packs and hiring owners, and keeps every pack competency desirable', () => {
    expect(INDUSTRY_JOBS).toHaveLength(5);
    expect(new Set([...JOBS, ...INDUSTRY_JOBS].map((j) => j.title)).size).toBe(10);
    for (const job of INDUSTRY_JOBS) {
      expect(jobTypeKeys).toContain(job.jobType);
      expect(v1.packs.map((p) => p.key)).toContain(job.pack);
      expect(HIRING_OWNERS.map((o) => o.key)).toContain(job.hiringOwner);
      for (const c of industryRubric(job, v1)) {
        expect(c.levelNeeded).toBeGreaterThanOrEqual(1);
        expect(c.levelNeeded).toBeLessThanOrEqual(5);
        if (c.origin === 'domain_pack') expect(c.type).toBe('desirable');
      }
    }
  });

  // Every capitalised word is a known place, acronym or the title's own words, so a named employer fails here.
  it('describes each employer generically, never by name', () => {
    const known = new Set('Abu Dhabi Dubai DIFC Riyadh Bengaluru QA SRE'.split(' '));
    for (const job of INDUSTRY_JOBS) {
      const words = new Set([...known, ...`${job.title} ${job.location}`.split(/[\s,]+/)]);
      // Only words inside a sentence: the first word of each sentence is capitalised anyway.
      const inside = [...job.description.matchAll(/(?<=[a-z,] )[A-Z][\w-]*/g)].map(([w]) => w);
      expect(inside.filter((w) => !words.has(w))).toEqual([]);
    }
  });

  it('AIV-P1-024: the design evidence belongs to Sara, Arjun and Layla and names Senior AI Engineer competencies', () => {
    const competencies = JOBS.find((j) => j.title === 'Senior AI Engineer')?.rubric.competencies.map((c) => c.name);
    expect([...new Set(EVIDENCE.map((e) => e.candidate))]).toEqual(['Sara Al Qahtani', 'Arjun Menon', 'Layla Haddad']);
    for (const { source, items } of EVIDENCE) {
      expect(source.url ?? 'https://code.credalent.example/').toMatch(/^https:\/\/code\.credalent\.example\//);
      for (const item of items) expect(competencies).toContain(item.competency);
    }
    // Sara's six competencies each have evidence, as the Candidate artboard shows.
    const sara = EVIDENCE.filter((e) => e.candidate === 'Sara Al Qahtani').flatMap((e) =>
      e.items.map((i) => i.competency),
    );
    expect(sara.toSorted()).toEqual(competencies?.toSorted());
  });
});

const lastWord = (name: string) => name.split(' ').at(-1);

describe('the demo cast reads like a real hiring team (AIV-P1-094)', () => {
  it('names every person, not a title or initials, and no two share a surname', () => {
    for (const p of people) expect(p.displayName).toMatch(/^[A-Z][a-z]+( [A-Za-z]+)+$/);
    for (const { displayName } of [RECRUITER, ...HIRING_OWNERS])
      expect(displayName).not.toMatch(/\b(Head|VP|CPO|Director|Manager)\b/);
    const surnames = people.map((p) => lastWord(p.displayName));
    expect(surnames.filter((n, i) => surnames.indexOf(n) !== i)).toEqual([]);
  });

  it('gives every job a written description and its own date, and varies how success statements open', () => {
    for (const job of [...JOBS, ...INDUSTRY_JOBS]) {
      expect(job.description).not.toMatch(/a synthetic demo job/);
      expect(job.description.split('\n\n')).toHaveLength(2);
    }
    expect(new Set(JOBS.map((j) => j.addedOn)).size).toBe(JOBS.length);
    for (const job of JOBS)
      expect(job.addedOn <= (job.supersedes?.approvedOn ?? job.rubric.approvedOn ?? '9')).toBe(true);
    const openers = JOBS.map((j) => j.successStatement.split(' ').slice(0, 2).join(' '));
    expect(new Set(openers).size).toBe(JOBS.length);
  });

  it('fills "Evidence expected" on every rubric row, industry jobs included', () => {
    for (const job of INDUSTRY_JOBS)
      for (const c of industryRubric(job, v1))
        expect(c.evidenceExpected.trim(), `${job.title}: ${c.name}`).not.toBe('');
  });

  it('keeps evidence excerpts as quotes, not labels', () => {
    for (const { items } of EVIDENCE) for (const i of items) expect(i.excerpt.split(' ').length).toBeGreaterThan(6);
  });
});
