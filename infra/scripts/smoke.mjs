// Deploy smoke test (AIV-P0-006). Runs inside the VNet as a job execution (the shared environment is internal):
// passes when /api/health reports the expected commit and /api/ready answers 200, retrying while the app scales from
// zero. Env: SMOKE_URL (https://<web fqdn>), COMMIT. Exit code 0 = live, 1 = roll back.
const { SMOKE_URL: base, COMMIT: commit } = process.env;
const deadline = Date.now() + 4 * 60_000;

while (Date.now() < deadline) {
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    const ready = await fetch(`${base}/api/ready`);
    console.error(`health commit=${health.commit} ready=${ready.status}`);
    if (health.commit === commit && ready.status === 200) process.exit(0);
  } catch (error) {
    console.error(`not reachable yet: ${error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
console.error(`smoke failed: expected commit ${commit} live and ready`);
process.exit(1);
