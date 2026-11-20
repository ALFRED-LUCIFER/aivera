// The server-side fetch of a candidate-supplied link (AIV-P1-077), with the SSRF guard: https only, no credentials,
// every resolved address checked before connecting and the connection pinned to it (no second DNS lookup, so DNS
// rebinding cannot swap it), every redirect hop checked the same way, robots.txt respected, 10 s in total, 2 MB of
// HTML at most. Platform only (node:https, node:dns); nothing here logs, and no URL reaches an error message.
import { lookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
// The module, not a destructured `request`, so interceptors that patch it (msw in tests) see the call.
import https from 'node:https';
import { isIP } from 'node:net';
import type { FetchPage, FetchFailure } from '../application/linkRead.ts';
import { checkLinkUrl, isRefusedAddress, LINK_LIMITS, ROBOTS_AGENT, robotsAllows } from '../domain/link.ts';

/** Every address the host resolves to; the default asks the system resolver once. */
export type Resolve = (host: string) => Promise<{ address: string; family: number }[]>;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = `${ROBOTS_AGENT}/1.0`;

class Refused extends Error {
  readonly reason: FetchFailure;
  constructor(reason: FetchFailure) {
    super(reason);
    this.reason = reason;
  }
}

export function createLinkFetcher({
  resolve = (host) => lookup(host, { all: true, verbatim: true }),
  limits = LINK_LIMITS,
}: { resolve?: Resolve; limits?: { timeoutMs: number; maxBytes: number; maxRedirects: number } } = {}): FetchPage {
  /** One GET to the checked address of `target`; the response is not read yet. */
  async function get(target: URL, signal: AbortSignal): Promise<IncomingMessage> {
    const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host);
    // SAFETY: every resolved address is checked, so a host that also answers with a private address is refused.
    const address = addresses[0]?.address;
    if (address === undefined || addresses.some((a) => isRefusedAddress(a.address)))
      throw new Refused('refused_address');
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
          headers: { host: target.host, 'user-agent': USER_AGENT, accept: 'text/html' },
          agent: false,
          signal,
        },
        done,
      );
      req.on('error', fail);
      req.end();
    });
  }

  /** GETs `url`, following at most `maxRedirects` redirects, each hop checked (and robots.txt asked) first. */
  async function follow(url: string, signal: AbortSignal, robots: Map<string, string> | null) {
    let target = checkLinkUrl(url);
    for (let hop = 0; ; hop++) {
      if (!target) throw new Refused('refused_url');
      if (robots && !(await robotsAllow(target, signal, robots))) throw new Refused('robots');
      const response = await get(target, signal);
      const location = REDIRECTS.has(response.statusCode ?? 0) ? response.headers.location : undefined;
      if (location === undefined) return response;
      response.destroy();
      if (hop === limits.maxRedirects) throw new Refused('redirects');
      const next = URL.parse(location, target.href);
      target = next && checkLinkUrl(next.href);
    }
  }

  /** The body, cut off and refused past `maxBytes` while it streams. */
  async function body(response: IncomingMessage): Promise<Buffer> {
    if (Number(response.headers['content-length']) > limits.maxBytes) {
      response.destroy();
      throw new Refused('too_large');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > limits.maxBytes) {
        response.destroy();
        throw new Refused('too_large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /** robots.txt of the target's origin, read once per fetch: missing (4xx) allows all, unavailable (5xx) refuses. */
  async function robotsAllow(target: URL, signal: AbortSignal, cache: Map<string, string>) {
    let txt = cache.get(target.origin);
    if (txt === undefined) {
      const response = await follow(`${target.origin}/robots.txt`, signal, null);
      const status = response.statusCode ?? 0;
      if (status >= 200 && status < 300) txt = (await body(response)).toString('utf8');
      else {
        response.destroy();
        // RFC 9309: an unreachable robots.txt means the whole site is disallowed.
        if (status < 400 || status >= 500) throw new Refused('robots');
        txt = '';
      }
      cache.set(target.origin, txt);
    }
    return robotsAllows(txt, target.pathname + target.search);
  }

  async function read(url: string, signal: AbortSignal): Promise<string> {
    const response = await follow(url, signal, new Map());
    const status = response.statusCode ?? 0;
    const type = response.headers['content-type'] ?? '';
    if (status < 200 || status >= 300 || !/^text\/html\s*(;|$)/i.test(type)) {
      response.destroy();
      throw new Refused(status < 200 || status >= 300 ? 'status' : 'not_html');
    }
    const data = await body(response);
    const charset = /charset="?([\w-]+)/i.exec(type)?.[1] ?? 'utf-8';
    try {
      return new TextDecoder(charset).decode(data);
    } catch {
      return new TextDecoder().decode(data);
    }
  }

  return async (url) => {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Refused('timeout'));
      }, limits.timeoutMs);
    });
    const work = read(url, controller.signal);
    // The loser of the race settles later; its rejection is already answered.
    work.catch(() => undefined);
    try {
      return { ok: true, html: await Promise.race([work, timeout]) };
    } catch (error) {
      return { ok: false, reason: error instanceof Refused ? error.reason : 'network' };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
