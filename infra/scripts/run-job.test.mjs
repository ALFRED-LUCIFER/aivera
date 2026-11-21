// node --test infra/scripts (pr.yml): run-job.sh takes its resource group from RG, never a built-in one (AIV-P1-096).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('run-job.sh', import.meta.url).pathname;

// A fake `az` on PATH that logs its arguments and answers like a job that succeeds at once.
function run(env) {
  const bin = mkdtempSync(join(tmpdir(), 'run-job-'));
  const log = join(bin, 'calls');
  writeFileSync(
    join(bin, 'az'),
    `#!/bin/sh\necho "$*" >> "${log}"\ncase "$*" in *"job start"*) echo exec-1 ;; *) echo Succeeded ;; esac\n`,
  );
  chmodSync(join(bin, 'az'), 0o755);
  const result = spawnSync('sh', [script, 'job-aivera-migrate-pilot'], {
    env: { PATH: `${bin}:/usr/bin:/bin`, ...env },
    encoding: 'utf8',
  });
  let calls = '';
  try {
    calls = readFileSync(log, 'utf8');
  } catch {}
  return { ...result, calls };
}

test('runs the job in the resource group RG names', () => {
  const { status, calls } = run({ RG: 'rg-aivera-pilot' });
  assert.equal(status, 0);
  assert.match(calls, /^containerapp job start -g rg-aivera-pilot -n job-aivera-migrate-pilot/m);
  assert.match(
    calls,
    /^containerapp job execution show -g rg-aivera-pilot -n job-aivera-migrate-pilot --job-execution-name exec-1/m,
  );
});

test('refuses to start without RG', () => {
  const { status, calls, stderr } = run({});
  assert.notEqual(status, 0);
  assert.equal(calls, '');
  assert.match(stderr, /set RG/);
});
