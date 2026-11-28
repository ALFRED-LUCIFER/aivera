import { createCvFetcher, type Resolve } from '@credalent/files/composition';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// AIV-P1-103: the SSRF guard of a sheet's CV links, over Node's real HTTPS client answered by msw, with a stubbed
// resolver. Hosts are synthetic (.credalent.example); 93.184.215.14 stands in for a public address.

const PUBLIC = '93.184.215.14';
const CV = 'sara.credalent.example';
const PDF = Buffer.from('%PDF-1.7\nsynthetic CV of Sara Al Qahtani\n');

let dns: Record<string, string[]> = {};
const resolve: Resolve = async (host) =>
  (dns[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

/** Every request that left, as "<address the connection went to> <Host header><path>". */
const sent: string[] = [];
const pdf = (body: Buffer | ReadableStream = PDF, headers: Record<string, string> = {}) =>
  new HttpResponse(body, { headers: { 'content-type': 'application/pdf', ...headers } });
const redirect = (location: string) => new HttpResponse(null, { status: 302, headers: { location } });

const server = setupServer(
  http.get(`https://${PUBLIC}/cv.pdf`, () => pdf()),
  http.get(`https://${PUBLIC}/moved`, () => redirect('https://10.0.0.5/cv.pdf')),
  http.get(`https://${PUBLIC}/moved-host`, () => redirect('https://intranet.credalent.example/cv.pdf')),
  http.get(`https://${PUBLIC}/moved-http`, () => redirect('http://sara.credalent.example/cv.pdf')),
  http.get(`https://${PUBLIC}/loop`, () => redirect('/loop')),
  http.get(`https://${PUBLIC}/gone.pdf`, () => new HttpResponse('Not here', { status: 404 })),
  http.get(`https://${PUBLIC}/huge.pdf`, () => {
    const chunk = new Uint8Array(1024 * 1024);
    let pushed = 0;
    // Streamed with no content-length, so only the running count can stop it.
    return pdf(
      new ReadableStream({
        pull(controller) {
          if (pushed++ > 12) controller.close();
          else controller.enqueue(chunk);
        },
      }),
    );
  }),
  http.get(`https://${PUBLIC}/slow.pdf`, async () => {
    await delay(2_000);
    return pdf();
  }),
);

const fetchCv = createCvFetcher({ resolve });

beforeAll(() => {
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    sent.push(`${url.hostname} ${request.headers.get('host')}${url.pathname}`);
  });
  server.listen({ onUnhandledFrame: 'error' });
});
afterAll(() => server.close());
beforeEach(() => {
  sent.length = 0;
  dns = {
    [CV]: [PUBLIC],
    'intranet.credalent.example': ['10.0.4.12'],
    'twofaced.credalent.example': [PUBLIC, '10.0.4.12'],
  };
});

describe('A CV link on a public host', () => {
  it('is fetched from the checked address, with the host name only in the Host header and TLS name', async () => {
    const fetched = await fetchCv(`https://${CV}/cv.pdf`);
    expect(fetched?.data.equals(PDF)).toBe(true);
    expect(fetched?.contentType).toBe('application/pdf');
    expect(sent).toEqual([`${PUBLIC} ${CV}/cv.pdf`]);
  });

  it('that returns 404 could not be read', async () => {
    expect(await fetchCv(`https://${CV}/gone.pdf`)).toBeNull();
  });

  it('over 10 MB, or slower than the timeout, could not be read', async () => {
    expect(await fetchCv(`https://${CV}/huge.pdf`)).toBeNull();
    const quick = createCvFetcher({ resolve, limits: { timeoutMs: 200, maxBytes: 1024, maxRedirects: 3 } });
    expect(await quick(`https://${CV}/slow.pdf`)).toBeNull();
  });
});

describe('Scenario Outline: CV links that are not HTTPS to a public host are refused', () => {
  // SAFETY: mutation check: removed the isRefusedAddress check in get() (cvFetch.ts) -> the three address rows, the private-host test and the redirect test failed
  it.each([
    'http://cv.credalent.example/a.pdf',
    'https://127.0.0.1/a.pdf',
    'https://169.254.169.254/metadata',
    'https://10.0.0.5/cv.pdf',
  ])('%s is not fetched', async (url) => {
    expect(await fetchCv(url)).toBeNull();
    expect(sent).toEqual([]);
  });

  it('refuses a host that resolves to a private address, even alongside a public one', async () => {
    expect(await fetchCv('https://intranet.credalent.example/cv.pdf')).toBeNull();
    expect(await fetchCv('https://twofaced.credalent.example/cv.pdf')).toBeNull();
    expect(sent).toEqual([]);
  });

  it('refuses a redirect to a private address, a private host or plain http, and a redirect loop', async () => {
    for (const path of ['moved', 'moved-host', 'moved-http']) {
      sent.length = 0;
      expect(await fetchCv(`https://${CV}/${path}`)).toBeNull();
      expect(sent).toEqual([`${PUBLIC} ${CV}/${path}`]);
    }
    sent.length = 0;
    expect(await fetchCv(`https://${CV}/loop`)).toBeNull();
    expect(sent).toHaveLength(4);
  });
});
