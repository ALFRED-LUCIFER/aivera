import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// AIV-P2-061 (ADR-004): migrations that are safe to apply on a live database.

const repoRoot = join(import.meta.dirname, '..', '..', '..');

type Journal = { entries: { tag: string; when: number }[] };

/**
 * Drizzle's migrator applies only entries whose `when` is later than the last applied one, so an entry out of order is
 * skipped without an error. Each miss names the journal and the entry.
 */
export const journalMisses = (file: string, journal: Journal): string[] =>
  journal.entries.flatMap((entry, i) => {
    const previous = journal.entries[i - 1];
    return previous && entry.when <= previous.when
      ? [`${file}: ${entry.tag} has "when" ${entry.when}, not after ${previous.tag} (${previous.when})`]
      : [];
  });

/**
 * Statement patterns that lock or fail on a table with rows: a NOT NULL column with no default fails on existing rows
 * (expand first: nullable or with a default, backfill, then SET NOT NULL), and a plain CHECK on the audit log validates
 * every row under an ACCESS EXCLUSIVE lock (add it NOT VALID; VALIDATE CONSTRAINT in a later migration, see
 * docs/runbooks/local-development.md).
 */
export const riskyStatements = (migration: string): string[] =>
  migration
    .replace(/--[^\n]*/g, '')
    .split(';')
    .flatMap((s) => [
      ...(/\bADD\s+COLUMN\b/i.test(s) && /\bNOT\s+NULL\b/i.test(s) && !/\b(?:DEFAULT|GENERATED)\b/i.test(s)
        ? ['ADD COLUMN ... NOT NULL without a DEFAULT']
        : []),
      ...(/\bALTER\s+TABLE\s+"?audit"?\./i.test(s) &&
      /\bADD\s+CONSTRAINT\b[\s\S]*\bCHECK\b/i.test(s) &&
      !/\bNOT\s+VALID\b/i.test(s)
        ? ['ADD CONSTRAINT ... CHECK on audit without NOT VALID']
        : []),
    ]);

/**
 * Each journal's entry count before the lint: those migrations were applied and are never edited (AGENTS.md 3.3).
 * Every later entry is linted, whatever its `when`; a journal not listed here (a new module) is linted from its first.
 */
const APPLIED_BEFORE_LINT: Record<string, number> = {
  'modules/assessment': 2,
  'modules/audit': 26,
  'modules/candidate-accounts': 3,
  'modules/candidates': 4,
  'modules/evidence': 24,
  'modules/files': 2,
  'modules/identity': 1,
  'modules/intake': 3,
  'modules/jobs': 24,
  'modules/notifications': 2,
  'modules/ops': 2,
  'modules/workspaces': 17,
  'packages/ai': 4,
  'tests/integration/fixtures/modules/fixture_notes': 2,
};

const journals = execFileSync('git', ['ls-files', '*/migrations/meta/_journal.json'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .map((file) => ({ file, journal: JSON.parse(readFileSync(join(repoRoot, file), 'utf8')) as Journal }));

describe('migrations (ADR-004, AIV-P2-061)', () => {
  it('finds every module journal', () => {
    expect(journals.length).toBeGreaterThanOrEqual(13);
  });

  // SAFETY: mutation check: set evidence 0012's "when" below 0011's -> this test failed naming the journal and 0012_evidence_mapping
  it('every journal "when" is strictly increasing, so the migrator skips nothing', () => {
    expect(journals.flatMap(({ file, journal }) => journalMisses(file, journal))).toEqual([]);
  });

  it('an entry whose "when" is not after the previous one is reported with its module and tag', () => {
    const journal = {
      entries: [
        { tag: '0000_init', when: 2 },
        { tag: '0001_late', when: 2 },
        { tag: '0002_ok', when: 3 },
      ],
    };
    expect(journalMisses('modules/jobs/x/_journal.json', journal)).toEqual([
      'modules/jobs/x/_journal.json: 0001_late has "when" 2, not after 0000_init (2)',
    ]);
  });

  // SAFETY: mutation check: added `ALTER TABLE "evidence"."source" ADD COLUMN "x" text NOT NULL;` to the new migration, its `when` set back to just after 0023 -> this test failed
  it('no migration after the lint adds a NOT NULL column without a default or a plain CHECK on audit', () => {
    const misses = journals.flatMap(({ file, journal }) =>
      journal.entries.slice(APPLIED_BEFORE_LINT[file.split('/src/')[0] ?? ''] ?? 0).flatMap(({ tag }) => {
        const path = join(dirname(dirname(file)), `${tag}.sql`);
        return riskyStatements(readFileSync(join(repoRoot, path), 'utf8')).map((reason) => `${path}: ${reason}`);
      }),
    );
    expect(misses).toEqual([]);
  });

  it.each([
    ['ALTER TABLE "evidence"."source" ADD COLUMN "x" text NOT NULL;', 'ADD COLUMN ... NOT NULL without a DEFAULT'],
    [
      'ALTER TABLE "audit"."entry" ADD CONSTRAINT "entry_action_check" CHECK ("audit"."entry"."action" in (\'a\'));',
      'ADD CONSTRAINT ... CHECK on audit without NOT VALID',
    ],
  ])('rejects %s', (statement, reason) => {
    expect(riskyStatements(statement)).toEqual([reason]);
  });

  it.each([
    'ALTER TABLE "evidence"."source" ADD COLUMN "x" text DEFAULT \'\' NOT NULL;',
    'ALTER TABLE "evidence"."source" ADD COLUMN "x" text;',
    'ALTER TABLE "audit"."entry" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY;',
    'ALTER TABLE "audit"."entry" ADD CONSTRAINT "entry_action_check" CHECK ("action" in (\'a\')) NOT VALID;',
    'ALTER TABLE "audit"."entry" VALIDATE CONSTRAINT "entry_action_check";',
    'ALTER TABLE "jobs"."job" ADD CONSTRAINT "job_title_check" CHECK ("title" <> \'\');',
    '-- ADD COLUMN x text NOT NULL, in a comment\nSELECT 1;',
  ])('allows %s', (statement) => {
    expect(riskyStatements(statement)).toEqual([]);
  });
});
