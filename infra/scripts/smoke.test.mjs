// node --test infra/scripts (pr.yml): the smoke test's retry loop.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { smoke } from './smoke.mjs';

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
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
