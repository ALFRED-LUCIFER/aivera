import { intlConfig } from '@credalent/i18n';
import { SOURCES } from '@credalent/intake';
import { describe, expect, it } from 'vitest';
import { addApplicantsSchema, SOURCE_OPTIONS } from './addApplicants.ts';

const JOB = '0190d4a2-0000-7000-9000-000000001031';
const F1 = '0190d4a2-0000-7000-8000-0000000000f1';
const F2 = '0190d4a2-0000-7000-8000-0000000000f2';
const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `0190d4a2-0000-7000-8000-${String(i).padStart(12, '0')}`);

describe('SOURCE_OPTIONS', () => {
  it("offers every intake source but a member's link (recruiter, AIV-P1-076) exactly once, each with its label", async () => {
    expect(SOURCE_OPTIONS.toSorted()).toEqual(SOURCES.filter((s) => s !== 'recruiter').toSorted());
    const labels = (await intlConfig('en', 'UTC')).messages.addApplicants.sources;
    expect(SOURCE_OPTIONS.map((s) => labels[s])).toEqual(['LinkedIn', 'Referral', 'Email', 'WhatsApp', 'Careers page']);
  });
});

describe('addApplicantsSchema', () => {
  it("refuses the recruiter source, which is a member's link, not an upload", () => {
    expect(
      addApplicantsSchema.safeParse({ jobId: JOB, rightToProcessConfirmed: true, source: 'recruiter', fileIds: [F1] })
        .success,
    ).toBe(false);
  });

  // AIV-P1-104. SAFETY: mutation check: changed rightToProcessConfirmed from z.literal(true) to z.boolean() -> this test failed (a false tick parsed)
  it.each([false, undefined, 'true'])('refuses the confirmation %s', (value) => {
    const input = { jobId: JOB, source: 'linkedin', fileIds: [F1], rightToProcessConfirmed: value };
    expect(addApplicantsSchema.safeParse(input).success).toBe(false);
  });

  it('takes a job, a source and one or more file ids', () => {
    const input = { jobId: JOB, rightToProcessConfirmed: true, source: 'linkedin', fileIds: [F1, F2] };
    expect(addApplicantsSchema.parse(input)).toEqual(input);
  });

  it('takes up to 200 CVs at a time (AIV-P1-101), and refuses 201', () => {
    expect(
      addApplicantsSchema.safeParse({ jobId: JOB, rightToProcessConfirmed: true, source: 'email', fileIds: ids(200) })
        .success,
    ).toBe(true);
    expect(
      addApplicantsSchema.safeParse({ jobId: JOB, rightToProcessConfirmed: true, source: 'email', fileIds: ids(201) })
        .success,
    ).toBe(false);
  });

  it.each([
    ['no CV', { jobId: JOB, rightToProcessConfirmed: true, source: 'linkedin', fileIds: [] }],
    ['the same file twice', { jobId: JOB, rightToProcessConfirmed: true, source: 'linkedin', fileIds: [F1, F1] }],
    ['an unknown source', { jobId: JOB, rightToProcessConfirmed: true, source: 'fax', fileIds: [F1] }],
    ['a job that is not an id', { jobId: 'senior-ai-engineer', source: 'email', fileIds: [F1] }],
    ['a file that is not an id', { jobId: JOB, rightToProcessConfirmed: true, source: 'email', fileIds: ['cv.pdf'] }],
    [
      'a workspace from the client',
      { jobId: JOB, rightToProcessConfirmed: true, source: 'email', fileIds: [F1], workspaceId: JOB },
    ],
  ])('refuses %s', (_, input) => {
    expect(addApplicantsSchema.safeParse(input).success).toBe(false);
  });
});
