// The worker's fetch of a CV link from an imported sheet (AIV-P1-103), behind the SSRF guard: https only, no
// credentials, every resolved address checked before connecting and the connection pinned to it (no second DNS lookup,
// so DNS rebinding cannot swap it), every redirect hop checked the same way, 10 s in total, 10 MB at most. Platform
// only (node:https, node:dns). Nothing here logs, and no URL reaches an error: every failure is just null.
// shortcut: the evidence link fetch (modules/evidence/src/infrastructure/linkFetch.ts) does the same for HTML pages;
// merge the two into one guarded fetch when either changes.
import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
// The module, not a destructured `request`, so interceptors that patch it (msw in tests) see the call.
import https from 'node:https';
import { isIP } from 'node:net';
import { checkFetchUrl, CV_FETCH_LIMITS, isRefusedAddress } from '../domain/fetchGuard.ts';

/** Every address the host resolves to; the default asks the system resolver once. */
export type Resolve = (host: string) => Promise<{ address: string; family: number }[]>;

/** The body and its declared content type, or null when the link was refused or could not be read. */
export type FetchCv = (url: string) => Promise<{ data: Buffer; contentType: string } | null>;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export function createCvFetcher({
  resolve = (host) => lookup(host, { all: true, verbatim: true }),
  limits = CV_FETCH_LIMITS,
}: { resolve?: Resolve; limits?: { timeoutMs: number; maxBytes: number; maxRedirects: number } } = {}): FetchCv {
  /** One GET to the checked address of `target`; the response is not read yet. */
  async function get(target: URL, signal: AbortSignal): Promise<IncomingMessage> {
    const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
    // SAFETY: every resolved address is checked, so a host that also answers with a private address is refused.
    // IPv4 first: a worker without IPv6 egress would otherwise miss a dual-stack site.
    const address = (addresses.find((a) => a.family === 4) ?? addresses[0])?.address;
    if (address === undefined || addresses.some((a) => isRefusedAddress(a.address))) throw new Error('refused');
    return new Promise((done, fail) => {
      const req = https.request(
        {
          // SAFETY: the connection goes to the address checked above, never to the host name (DNS rebinding).
          host: address,
          port: target.port || 443,
          path: target.pathname + target.search,
          method: 'GET',
          // TLS still verifies the certificate against the host name.
          servername: isIP(host) ? undefined : host,
          headers: { host: target.host, accept: 'application/pdf, application/octet-stream, */*' },
          agent: false,
          signal,
        },
        done,
      );
      req.on('error', fail);
      req.end();
    });
  }

  async function read(url: string, signal: AbortSignal) {
    let target = checkFetchUrl(url);
    for (let hop = 0; ; hop++) {
      if (!target) return null;
      const response = await get(target, signal);
      const status = response.statusCode ?? 0;
      const location = REDIRECTS.has(status) ? response.headers.location : undefined;
      if (location === undefined) {
        if (status < 200 || status >= 300 || Number(response.headers['content-length']) > limits.maxBytes) {
          response.destroy();
          return null;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of response as AsyncIterable<Buffer>) {
          size += chunk.length;
          if (size > limits.maxBytes) {
            response.destroy();
            return null;
          }
          chunks.push(chunk);
        }
        return { data: Buffer.concat(chunks), contentType: response.headers['content-type'] ?? '' };
      }
      response.destroy();
      if (hop === limits.maxRedirects) return null;
      // SAFETY: every redirect hop goes through the same URL and address checks as the first request.
      const next = URL.parse(location, target.href);
      target = next && checkFetchUrl(next.href);
    }
  }

  return async (url) => {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((done) => {
      timer = setTimeout(() => {
        controller.abort();
        done(null);
      }, limits.timeoutMs);
    });
    const work = read(url, controller.signal);
    // The loser of the race settles later; its rejection is already answered.
    work.catch(() => undefined);
    try {
      return await Promise.race([work, timeout]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
