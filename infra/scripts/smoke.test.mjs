// node --test infra/scripts (pr.yml): the smoke test's retry loop.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { LOGO, smoke } from './smoke.mjs';

// The logo answers as an image unless a test serves it itself (`ownLogo`).
async function serve(handler, { ownLogo = false } = {}) {
  const server = createServer((req, res) => {
    if (req.url !== LOGO || ownLogo) return handler(req, res);
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => (server.closeAllConnections(), server.close()),
  };
}

test('retries until the new commit is live and ready', async () => {
  let calls = 0;
  const app = await serve((req, res) => {
    if (req.url === '/api/health') calls += 1;
    const live = calls >= 3; // the old revision answers first, then the new one
    res.writeHead(req.url === '/api/ready' && !live ? 503 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ commit: live ? 'new' : 'old' }));
  });
  try {
    assert.equal(await smoke({ base: app.base, commit: 'new', intervalMs: 5, log: () => {} }), true);
    assert.equal(calls, 3);
  } finally {
    app.close();
  }
});

test('fails when the commit never becomes ready', async () => {
  const app = await serve((req, res) => {
    res.writeHead(req.url === '/api/ready' ? 503 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ commit: 'new' }));
  });
  try {
    assert.equal(await smoke({ base: app.base, commit: 'new', timeoutMs: 50, intervalMs: 5, log: () => {} }), false);
  } finally {
    app.close();
  }
});

// AIV-P0-933: the logo through the image optimizer, as the sign-in page loads it.
// SAFETY: mutation check: dropped `logo.status === 200` from the pass condition -> the 404 case failed
// SAFETY: mutation check: dropped the `image/` content-type check -> the HTML case failed
for (const [name, status, type] of [
  ['the image leaves out public/ and the logo 404s', 404, 'image/png'],
  ['the logo answers 200 with a page, not an image', 200, 'text/html'],
])
  test(`fails when ${name}`, async () => {
    const app = await serve(
      (req, res) => {
        const isLogo = req.url === LOGO;
        res.writeHead(isLogo ? status : 200, { 'content-type': isLogo ? type : 'application/json' });
        res.end(isLogo ? '<html></html>' : JSON.stringify({ commit: 'new' }));
      },
      { ownLogo: true },
    );
    try {
      assert.equal(await smoke({ base: app.base, commit: 'new', timeoutMs: 50, intervalMs: 5, log: () => {} }), false);
    } finally {
      app.close();
    }
  });

// SAFETY: mutation check: removed the per-request AbortSignal.timeout -> this test failed (hung past the test timeout)
test('a hanging request times out and the loop retries', { timeout: 5_000 }, async () => {
  let calls = 0;
  const app = await serve((req, res) => {
    if (req.url === '/api/health') calls += 1;
    if (calls === 1) return; // the first health request never answers, as on a cold start
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ commit: 'new' }));
  });
  try {
    const live = await smoke({
      base: app.base,
      commit: 'new',
      timeoutMs: 2_000,
      intervalMs: 5,
      requestMs: 100,
      log: () => {},
    });
    assert.equal(live, true);
  } finally {
    app.close();
  }
});
