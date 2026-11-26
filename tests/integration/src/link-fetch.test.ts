import { createLinkFetcher, type Resolve } from '@credalent/evidence/composition';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// AIV-P1-077: the SSRF guard of the link fetch, over Node's real HTTPS client answered by msw, with a stubbed resolver.
// Hosts are synthetic (.credalent.example); 93.184.215.14 and 93.184.215.15 stand in for public addresses.

const PUBLIC = '93.184.215.14';
const OTHER_PUBLIC = '93.184.215.15';
const SHOP = 'shop.credalent.example';
const PAGE =
  '<html><head><title>Merchant help assistant</title></head><body><main><p>Shipped.</p></main></body></html>';

/** What each host resolves to; a list per call answers the calls in turn (DNS rebinding). */
let dns: Record<string, string[] | string[][]> = {};
const lookups: string[] = [];
const resolve: Resolve = async (host) => {
  lookups.push(host);
  const answer = dns[host] ?? [];
  const nth = lookups.filter((h) => h === host).length - 1;
  const addresses = Array.isArray(answer[0]) ? ((answer as string[][])[nth] ?? []) : (answer as string[]);
  return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

/** Every request that left, as "<host the connection went to> <Host header><path>". */
const sent: string[] = [];
const html = (body: string, init?: ResponseInit) =>
  new HttpResponse(body, { ...init, headers: { 'content-type': 'text/html; charset=utf-8', ...init?.headers } });
const redirect = (location: string) => new HttpResponse(null, { status: 302, headers: { location } });

const server = setupServer(
  http.get(`https://${PUBLIC}/robots.txt`, ({ request }) =>
    request.headers.get('host') === 'private.credalent.example'
      ? new HttpResponse('User-agent: *\nDisallow: /case-study\n', { headers: { 'content-type': 'text/plain' } })
      : new HttpResponse(null, { status: request.headers.get('host') === 'down.credalent.example' ? 503 : 404 }),
  ),
  http.get(`https://${OTHER_PUBLIC}/robots.txt`, () => new HttpResponse(null, { status: 404 })),
  http.get(`https://${PUBLIC}/merchant-assistant`, () => html(PAGE)),
  http.get(`https://${OTHER_PUBLIC}/write-up`, () => html(PAGE)),
  http.get(`https://${PUBLIC}/moved`, () => redirect('https://10.0.0.5/admin')),
  http.get(`https://${PUBLIC}/elsewhere`, () => redirect(`https://other.credalent.example/write-up`)),
  http.get(`https://${PUBLIC}/loop`, ({ request }) => {
    const n = Number(new URL(request.url).searchParams.get('n') ?? '0');
    // A page after the 6th hop, so following more than 3 would succeed rather than loop for ever.
    if (n >= 6) return html(PAGE);
    return redirect(`/loop?n=${n + 1}`);
  }),
  http.get(`https://${PUBLIC}/huge`, () => {
    const chunk = new TextEncoder().encode(`<p>${'x'.repeat(64 * 1024)}</p>`);
    let pushed = 0;
    // Streamed with no content-length, so only the running count can stop it.
    const stream = new ReadableStream({
      pull(controller) {
        if (pushed++ > 40) controller.close();
        else controller.enqueue(chunk);
      },
    });
    return new HttpResponse(stream, { headers: { 'content-type': 'text/html' } });
  }),
  http.get(`https://${PUBLIC}/huge-declared`, () =>
    html('<p>small</p>', { headers: { 'content-length': String(3 * 1024 * 1024) } }),
  ),
  http.get(`https://${PUBLIC}/case-study`, () => html(PAGE)),
  http.get(`https://${PUBLIC}/slow`, async () => {
    await delay(2_000);
    return html(PAGE);
  }),
  http.get(
    `https://${PUBLIC}/report.pdf`,
    () => new HttpResponse('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
  ),
  http.get(`https://${PUBLIC}/gone`, () => html('Not here', { status: 404 })),
);

const fetchPage = createLinkFetcher({ resolve });

beforeAll(() => {
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    sent.push(`${url.hostname} ${request.headers.get('host')}${url.pathname}${url.search}`);
  });
  server.listen({ onUnhandledFrame: 'error' });
});
afterAll(() => server.close());
beforeEach(() => {
  sent.length = 0;
  lookups.length = 0;
  dns = {
    [SHOP]: [PUBLIC],
    'other.credalent.example': [OTHER_PUBLIC],
    'private.credalent.example': [PUBLIC],
    'down.credalent.example': [PUBLIC],
  };
});

describe('A link on a public address', () => {
  it('is fetched from the checked address, with the host name only in the Host header and TLS name', async () => {
    expect(await fetchPage(`https://${SHOP}/merchant-assistant`)).toEqual({ ok: true, html: PAGE });
    expect(sent).toEqual([`${PUBLIC} ${SHOP}/robots.txt`, `${PUBLIC} ${SHOP}/merchant-assistant`]);
  });

  it('follows a redirect to another public host, asking its robots.txt first', async () => {
    expect((await fetchPage(`https://${SHOP}/elsewhere`)).ok).toBe(true);
    expect(sent).toEqual([
      `${PUBLIC} ${SHOP}/robots.txt`,
      `${PUBLIC} ${SHOP}/elsewhere`,
      `${OTHER_PUBLIC} other.credalent.example/robots.txt`,
      `${OTHER_PUBLIC} other.credalent.example/write-up`,
    ]);
  });
});

describe('Scenario Outline: A link to a private or unsafe address is refused before any request', () => {
  // SAFETY: mutation check: removed the isRefusedAddress check in get() -> every row failed (requests left, msw errored)
  it.each([
    ['https://127.0.0.1/', null, null],
    ['https://intranet.credalent.example/merchant-assistant', 'intranet.credalent.example', '10.0.4.12'],
    ['https://metadata.credalent.example/latest/', 'metadata.credalent.example', '169.254.169.254'],
    ['https://cgnat.credalent.example/', 'cgnat.credalent.example', '100.64.0.7'],
    ['https://mapped.credalent.example/', 'mapped.credalent.example', '::ffff:10.0.0.1'],
    ['https://loop6.credalent.example/', 'loop6.credalent.example', '::1'],
    ['https://[::1]/', null, null],
  ])('%s (%s resolving to %s) makes no request', async (url, host, address) => {
    if (host && address) dns[host] = [address];
    expect(await fetchPage(url)).toEqual({ ok: false, reason: 'refused_address' });
    expect(sent).toEqual([]);
  });

  it('a host that answers with a public and a private address is refused', async () => {
    dns['mixed.credalent.example'] = [PUBLIC, '10.0.0.1'];
    expect(await fetchPage('https://mixed.credalent.example/')).toEqual({ ok: false, reason: 'refused_address' });
    expect(sent).toEqual([]);
  });
});

describe('DNS rebinding', () => {
  // SAFETY: mutation check: connected with host: target.hostname instead of the checked address -> this test failed
  it('a resolver that answers public, then private, never gets a connection to the private address', async () => {
    dns[SHOP] = [[PUBLIC], ['10.0.0.9'], ['10.0.0.9']];
    const result = await fetchPage(`https://${SHOP}/merchant-assistant`);
    // Every request went to the address checked for it; the private answer was refused before a connection.
    expect(sent.every((line) => line.startsWith(`${PUBLIC} `))).toBe(true);
    expect(sent).toEqual([`${PUBLIC} ${SHOP}/robots.txt`]);
    expect(result).toEqual({ ok: false, reason: 'refused_address' });
  });
});

describe('Scenario Outline: Unsafe link forms and redirects are refused', () => {
  // SAFETY: mutation check: checkLinkUrl accepted 'http:' -> this test failed (a request left)
  it('http: no request is made because only https links are read', async () => {
    expect(await fetchPage(`http://${SHOP}/merchant-assistant`)).toEqual({ ok: false, reason: 'refused_url' });
    expect(sent).toEqual([]);
    expect(lookups).toEqual([]);
  });

  it('credentials: no request is made because links with credentials are refused', async () => {
    expect(await fetchPage(`https://sara:secret@${SHOP}/`)).toEqual({ ok: false, reason: 'refused_url' });
    expect(sent).toEqual([]);
  });

  // SAFETY: mutation check: followed a redirect hop with no checks (scheme, address, robots) -> this test failed
  it('the redirect to "https://10.0.0.5/admin" is refused before it is followed', async () => {
    expect(await fetchPage(`https://${SHOP}/moved`)).toEqual({ ok: false, reason: 'refused_address' });
    expect(sent).toEqual([`${PUBLIC} ${SHOP}/robots.txt`, `${PUBLIC} ${SHOP}/moved`]);
  });

  // SAFETY: mutation check: removed the maxRedirects check -> this test failed (it followed the 4th redirect)
  it('the 4th redirect is refused because at most 3 redirects are followed', async () => {
    expect(await fetchPage(`https://${SHOP}/loop`)).toEqual({ ok: false, reason: 'redirects' });
    expect(sent.filter((line) => line.includes('/loop'))).toEqual([
      `${PUBLIC} ${SHOP}/loop`,
      `${PUBLIC} ${SHOP}/loop?n=1`,
      `${PUBLIC} ${SHOP}/loop?n=2`,
      `${PUBLIC} ${SHOP}/loop?n=3`,
    ]);
  });

  // SAFETY: mutation check: removed the running size check in body() -> this test failed (the page was returned)
  it('reading stops after 2 MB of HTML and the page text is not returned', async () => {
    expect(await fetchPage(`https://${SHOP}/huge`)).toEqual({ ok: false, reason: 'too_large' });
    expect(await fetchPage(`https://${SHOP}/huge-declared`)).toEqual({ ok: false, reason: 'too_large' });
  });

  // SAFETY: mutation check: skipped robotsAllow in follow() -> this test failed (the page was requested)
  it('no page request is made because robots.txt disallows "/case-study"', async () => {
    expect(await fetchPage('https://private.credalent.example/case-study')).toEqual({ ok: false, reason: 'robots' });
    expect(sent).toEqual([`${PUBLIC} private.credalent.example/robots.txt`]);
  });

  it('a robots.txt that answers 503 disallows the whole site (RFC 9309)', async () => {
    expect(await fetchPage('https://down.credalent.example/merchant-assistant')).toEqual({
      ok: false,
      reason: 'robots',
    });
    expect(sent).toEqual([`${PUBLIC} down.credalent.example/robots.txt`]);
  });
});

describe('Scenario: A link that cannot be reached', () => {
  // SAFETY: mutation check: removed the timeout race -> this test failed (it waited for the slow page)
  it('a page slower than the limit is given up on at the limit', async () => {
    const quick = createLinkFetcher({
      resolve,
      limits: { timeoutMs: 200, maxBytes: 2 * 1024 * 1024, maxRedirects: 3 },
    });
    const started = performance.now();
    expect(await quick(`https://${SHOP}/slow`)).toEqual({ ok: false, reason: 'timeout' });
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  it('a non-HTML response or an error status is not read', async () => {
    expect(await fetchPage(`https://${SHOP}/report.pdf`)).toEqual({ ok: false, reason: 'not_html' });
    expect(await fetchPage(`https://${SHOP}/gone`)).toEqual({ ok: false, reason: 'status' });
  });

  it('a host that does not resolve is not reachable', async () => {
    expect(await fetchPage('https://nowhere.credalent.example/')).toEqual({ ok: false, reason: 'refused_address' });
  });
});
