import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { failUnmocked } from './unmocked.ts';

// A real local server stands in for an outside host: with the guard gone, an unmocked request would reach it and succeed.
let real: Server;
let host: string;
const msw = setupServer(http.get(/\/mocked$/, () => HttpResponse.text('fixture')));

beforeAll(async () => {
  real = createServer((_req, res) => res.end('reached the real host'));
  await new Promise<void>((resolve) => real.listen(0, '127.0.0.1', resolve));
  host = `http://127.0.0.1:${(real.address() as AddressInfo).port}`;
  msw.listen({ onUnhandledFrame: failUnmocked(host) });
});
afterAll(() => {
  msw.close();
  real.close();
});

// SAFETY: mutation check: the `Promise.reject(Response.error())` dropped from failUnmocked -> this test failed
it('fails an unmocked request to a fixture host as a network error, and answers a mocked one', async () => {
  await expect(fetch(`${host}/unmocked`)).rejects.toThrow(TypeError);
  expect(await (await fetch(`${host}/mocked`)).text()).toBe('fixture');
});
