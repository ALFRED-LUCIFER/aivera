// node --test infra/scripts (pr.yml): the pilot holds real candidate data, so nothing in its template may leave UAE North
// (AGENTS.md 1.10), synthetic-only behaviour stays off, and its parameter file holds names and sizes only (AIV-P1-096).
// A source check: pr.yml also builds main.bicep and pilot.bicepparam with the Bicep CLI.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const infra = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, infra), 'utf8');
const bicep = ['main.bicep', ...readdirSync(new URL('modules/', infra)).map((f) => `modules/${f}`)].map((path) => ({
  path,
  lines: read(path).split('\n'),
}));
const pilot = read('pilot.bicepparam');

// SAFETY: mutation check: set network.bicep's Log Analytics location to 'westeurope' -> this test failed
test('every resource is in the location parameter, UAE North or global', () => {
  for (const { path, lines } of bicep)
    lines.forEach((line, i) => {
      const value = line.match(/^\s*(?:location:|var location =)\s*(.+?)\s*(?:\/\/.*)?$/)?.[1];
      if (value) assert.match(value, /^(location|'uaenorth'|'global')$/, `${path}:${i + 1}`);
      if (line.includes('resourceGroup().location'))
        assert.match(line, /^param location string = resourceGroup\(\)\.location$/, `${path}:${i + 1}`);
    });
  assert.match(pilot, /^param location = 'uaenorth'$/m);
});

// SAFETY: mutation check: dropped `env == 'dev' ?` from ai.bicep's gpt-main sku -> this test failed
test('nothing replicates or infers outside the region for the pilot', () => {
  for (const { path, lines } of bicep)
    lines.forEach((line, i) => {
      if (line.includes("'GlobalStandard'")) assert.match(line, /env == 'dev' \? 'GlobalStandard'/, `${path}:${i + 1}`);
      assert.doesNotMatch(line, /Standard_(RA)?G[RZ]S|geoRedundantBackup: 'Enabled'/, `${path}:${i + 1}`);
      if (line.includes('dataLocation =')) assert.match(line, /dataLocation = 'UAE'/, `${path}:${i + 1}`);
    });
});

test('the pilot turns off synthetic-only behaviour and turns on scanning and backups', () => {
  assert.match(pilot, /^param env = 'pilot'$/m);
  assert.match(pilot, /^param malwareScanning = true$/m);
  assert.match(pilot, /^param backupRetentionDays = \d+$/m);
  // APP_ENV decides the synthetic email band and fake AI (apps/web/src/server/notifications.ts, packages/ai).
  assert.match(read('modules/web.bicep'), /\{ name: 'APP_ENV', value: env \}/);
});

// Dev keeps its live "aivera" names; the pilot's are all built from `brand` (AIV-P0-035). Roles such as aivera_app keep theirs.
// SAFETY: mutation check: wrote 'id-aivera-${env}' back into foundation.bicep -> this test failed
test('no pilot resource name contains "aivera"', () => {
  for (const { path, lines } of bicep)
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*/, '');
      if (!/'[^']*aivera[^']*'/.test(code) || /^(param|@description)/.test(code.trim())) return;
      assert.match(code, /dev \?|env == 'dev' \?/, `${path}:${i + 1} names "aivera" outside a dev-only branch`);
    });
  assert.doesNotMatch(
    read('../.github/workflows/deploy-pilot.yml').replace(/ghcr\.io\S+|aivera_migrator/g, ''),
    /aivera/,
  );
});

test('the pilot parameter file holds no id, address or secret', () => {
  assert.doesNotMatch(pilot, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(pilot, /@[a-z0-9-]+\.[a-z]/i);
  assert.doesNotMatch(pilot, /secret|password|key\b/i);
});
