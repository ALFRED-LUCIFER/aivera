import { JOB_TYPES } from '@aivera/jobs';
import { describe, expect, it } from 'vitest';
import { CANDIDATES, HIRING_OWNERS, JOBS, RECRUITER, WORKSPACE } from './cast.ts';

const people = [RECRUITER, ...HIRING_OWNERS, ...CANDIDATES];

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
      expect(JOB_TYPES).toContain(job.jobType);
      expect(HIRING_OWNERS.map((o) => o.key)).toContain(job.hiringOwner);
      expect(job.rubric.competencies.reduce((sum, c) => sum + c.weight, 0)).toBe(100);
    }
  });

  it('matches the design: AI Engineer rubric v2 approved by the Head of Engineering on 12 Nov 2026; Designer a draft', () => {
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
