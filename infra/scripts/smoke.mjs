// Deploy smoke test (AIV-P0-006), run by deploy-dev.yml against the public dev URL: passes when /api/health reports
// the expected commit and /api/ready answers 200, retrying while the app scales from zero. Exit 0 = live, 1 = roll back.
// Usage: SMOKE_URL=https://<web fqdn> COMMIT=<sha> node infra/scripts/smoke.mjs
import { pathToFileURL } from 'node:url';

/** Polls until the commit is live and ready, or the time runs out. */
export async function smoke({
  base,
  commit,
  timeoutMs = 4 * 60_000,
  intervalMs = 10_000,
  requestMs = 30_000,
  log = console.error,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // A cold start can hold one request until ingress gives up (~4 min); cap each so the loop keeps retrying.
      const health = await (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(requestMs) })).json();
      const ready = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(requestMs) });
      log(`health commit=${health.commit} ready=${ready.status}`);
      if (health.commit === commit && ready.status === 200) return true;
    } catch (error) {
      log(`not reachable yet: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  log(`smoke failed: expected commit ${commit} live and ready`);
  return false;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit((await smoke({ base: process.env.SMOKE_URL, commit: process.env.COMMIT })) ? 0 : 1);
}
