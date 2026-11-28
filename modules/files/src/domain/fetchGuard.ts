// Which URLs and addresses the worker may fetch a candidate's CV from (AIV-P1-103): the SSRF guard. Pure.
// shortcut: the same rules as the evidence link fetch (modules/evidence/src/domain/link.ts, AIV-P1-077), copied because
// files may not import evidence; move both to one shared guard when either changes.
import { BlockList, isIP } from 'node:net';

/** A CV link is fetched within 10 s, at most the CV upload limit, through at most 3 redirects. */
export const CV_FETCH_LIMITS = { timeoutMs: 10_000, maxBytes: 10 * 1024 * 1024, maxRedirects: 3 } as const;

/** The URL when it may be fetched at all: https on its standard port, no `user:pass@`. Anything else makes no request. */
export function checkFetchUrl(url: string): URL | null {
  const parsed = URL.parse(url);
  // A port other than 443 is how a link reaches an internal service on a public address; a CV host needs none.
  if (!parsed || parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username || parsed.password) return null;
  return parsed;
}

// Every address that is not a public unicast one. BlockList matches IPv4-mapped IPv6 (::ffff:10.0.0.1) against the
// IPv4 rules too.
const refused = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // unspecified, "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. the cloud metadata address 169.254.169.254
  ['172.16.0.0', 12], // private
  ['168.63.129.16', 32], // Azure platform endpoint (wire server, DNS): public, but internal to the platform
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. broadcast
] as const)
  refused.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 96], // unspecified, loopback (::1) and IPv4-compatible forms
  ['::ffff:0:0:0', 96], // SIIT IPv4-translated: embeds an IPv4 address of any kind
  ['64:ff9b::', 96], // NAT64: would reach an IPv4 address of any kind
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 32], // Teredo: embeds an IPv4 address
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4: embeds an IPv4 address of any kind
  ['fc00::', 7], // unique local (private)
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated, still routed privately by some networks)
  ['ff00::', 8], // multicast
] as const)
  refused.addSubnet(net, prefix, 'ipv6');

/** True unless `address` is a public unicast IP address; anything that is not an IP address is refused too. */
export function isRefusedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return refused.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * The CV content type of a fetched file: the server's declared PDF or Word type, or a PDF by its magic bytes when the
 * server says only `application/octet-stream`; null for anything else, which is never stored.
 */
export function cvContentType(declared: string, data: Buffer): string | null {
  const type = declared.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === PDF || type === DOCX) return type;
  return data.subarray(0, 5).toString('latin1') === '%PDF-' ? PDF : null;
}
