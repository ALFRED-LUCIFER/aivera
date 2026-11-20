import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..', '..');

/**
 * The product is Credalent (AIV-P0-035). The old name may remain only where renaming would break something live.
 * Each entry: the pattern a remaining "aivera" token must match, and why it stays.
 */
export const KEPT: readonly (readonly [RegExp, string])[] = [
  [/^aivera_(?:app|public|migrator|relay|ops)$/, 'database role: applied migrations and RLS policies name it'],
  [/^suggested_by_aivera$/, 'stored competency origin value in an applied check constraint'],
  [/^aivera$/, 'database name on dev and in local/test PostgreSQL, Bicep tag and deployment-name context'],
  [
    /^(?:id|cae|ca|job|snet|rg|kv|ag|alert|appi|ai|acs|sb|evgt|oai|acs-email|log|psql)-aivera(?:-[\w-]*)?$/,
    'live Azure resource name on dev: renaming recreates it (owner-run migration)',
  ],
  [
    /^aivera-(?:ai|alerts|communication|database|deploy-access|environment|foundation|messaging|web|worker|dev|candidates-dev|web-dev|dev-deployer)?-?$/,
    'live Bicep deployment, action group, Entra app registration, secret description or role-id seed on dev',
  ],
  [/^aivera(?:dev|recruiters)$/, 'live Entra External ID tenant subdomain'],
  [/^(?:ALFRED-LUCIFER|alfred-lucifer|owner)\/aivera$/i, 'GitHub repository and container registry path (owner-owned)'],
  [/^seed\.aivera\.example$/, 'seed issuer: seeded identities on dev are keyed by it'],
  [
    /^aivera notifications (?:seal|recipient hash) v1$/,
    'key-derivation label: changing it makes sealed emails unreadable',
  ],
  [/^Aivera$/, 'documents the rename itself (ADR-001 note, artboards README, PR and test text)'],
];

/** Paths never scanned: applied migrations (never edited, AGENTS.md 3.3), and the guards that name the old word. */
const SKIP = [
  /\/migrations\//,
  /^tests\/architecture\/src\/brand\.test\.ts$/,
  /^packages\/i18n\/test\/i18n\.test\.ts$/,
  /^modules\/notifications\/src\/infrastructure\/templates\/render\.test\.ts$/,
];

/** Where the old name is about the rename itself, the capitalised word is allowed; anywhere else it is a miss. */
const RENAME_NOTES = new Set(['docs/adr/ADR-001-technology-stack.md', 'docs/01-design/artboards/README.md']);

const TOKEN = /aivera notifications (?:seal|recipient hash) v1|[\w.@/-]*aivera[\w.@/-]*/gi;

const tracked = (): string[] =>
  execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' }).split('\0').filter(Boolean);

const trim = (token: string) => token.replace(/^[/.@:-]+|[/.:-]+$/g, '').replace(/^.*\/\/([^@/]*@)?/, '');

const misses = (files: readonly string[]): string[] => {
  const out: string[] = [];
  for (const file of files) {
    if (SKIP.some((p) => p.test(file)) || /\.(?:png|jpe?g|woff2?|ico)$/.test(file)) continue;
    const text = readFileSync(join(repoRoot, file), 'utf8');
    if (!/aivera/i.test(text)) continue;
    for (const [line, content] of text.split('\n').entries())
      for (const raw of content.match(TOKEN) ?? []) {
        const token =
          trim(raw)
            .split(/[/@.]/)
            .find((part) => /aivera/i.test(part)) ?? raw;
        const kept = KEPT.find(([pattern]) => pattern.test(token));
        const capitalised = token === 'Aivera';
        if (!kept || (capitalised && !RENAME_NOTES.has(file))) out.push(`${file}:${line + 1} ${raw}`);
      }
  }
  return out;
};

describe('Scenario: No user-visible "Aivera" remains (AIV-P0-035)', () => {
  // SAFETY: mutation check: AppShell mark src set to /brand/aivera-mark.png -> this test failed
  // SAFETY: mutation check: appended "// Aivera" to a feature domain file -> this test failed
  it('every remaining "aivera" in the repository is a kept live name, each with its reason', () => {
    expect(misses(tracked())).toEqual([]);
  });

  it('every kept entry states its reason', () => {
    for (const [, reason] of KEPT) expect(reason.length).toBeGreaterThan(20);
  });
});
