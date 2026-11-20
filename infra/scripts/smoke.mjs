// Deploy smoke test (AIV-P0-006), run by deploy-dev.yml against the public dev URL: passes when /api/health reports
// the expected commit, /api/ready answers 200 and the logo from public/ loads (AIV-P0-933), retrying while the app
// scales from zero. Exit 0 = live, 1 = roll back.
// Usage: SMOKE_URL=https://<web fqdn> COMMIT=<sha> node infra/scripts/smoke.mjs
import { pathToFileURL } from 'node:url';

/** The sign-in page's logo URL (AuthPage renders it at w=96). */
export const LOGO = '/_next/image?url=%2Fbrand%2Fcredalent-mark.png&w=96&q=75';

/** Polls until the commit is live and ready, or the time runs out. */
export async function smoke({
  base,
  commit,
  timeoutMs = 4 * 60_000,
  intervalMs = 10_000,
  requestMs = 90_000,
  log = console.error,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // A cold start can hold one request until ingress gives up (~4 min); cap each (above a ~54 s cold start) so the loop keeps retrying.
      // Each request also stops at the deadline, so one pass of three requests cannot run far past it.
      const signal = () => AbortSignal.timeout(Math.max(1, Math.min(requestMs, deadline - Date.now())));
      const health = await (await fetch(`${base}/api/health`, { signal: signal() })).json();
      const ready = await fetch(`${base}/api/ready`, { signal: signal() });
      // The logo as pages load it, through the image optimizer: proves public/ is in the image and sharp works.
      // SAFETY: mutation check: removed the apps/web/public COPY from the Dockerfile -> this URL returned 404 (local build)
      const logo = await fetch(`${base}${LOGO}`, { signal: signal() });
      const logoType = logo.headers.get('content-type') ?? '';
      await logo.arrayBuffer();
      log(`health commit=${health.commit} ready=${ready.status} logo=${logo.status} ${logoType}`);
      if (health.commit === commit && ready.status === 200 && logo.status === 200 && logoType.startsWith('image/'))
        return true;
    } catch (error) {
      log(`not reachable yet: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  log(`smoke failed: expected commit ${commit} live and ready, with its logo`);
  return false;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit((await smoke({ base: process.env.SMOKE_URL, commit: process.env.COMMIT })) ? 0 : 1);
}
