// Shipped-product and write-up links as evidence (AIV-P1-077): a product page, a published write-up, a case study or a
// design share link counts as real work, supplied by the candidate, like a document (AIV-P1-028). The rules here are
// pure: which URLs and addresses may be fetched at all (the SSRF guard), robots.txt, and the page's title and text.
import { BlockList, isIP } from 'node:net';
import type { UnusualContent } from '@credalent/ai';
import { documentLimit, maskNotes, type DocumentItem } from './document.ts';

export const LINK_READ_STATUSES = ['pending', 'read', 'not_reachable', 'failed'] as const;
export type LinkReadStatus = (typeof LINK_READ_STATUSES)[number];

/** The label of a link that reached an application with no name of its own (AIV-P1-076's plain links). */
export const LINK_LABEL = 'Linked work';

/** The longest link kept: the web form's bound, and well under the unique index's key size. */
export const MAX_LINK_LENGTH = 2048;

export const LINK_LIMITS = { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 3 } as const;
/** The robots.txt user agent token the fetch answers to, and sends. */
export const ROBOTS_AGENT = 'CredalentBot';

/** The URL when it may be fetched at all: https, no `user:pass@`. Anything else makes no request. */
export function checkLinkUrl(url: string): URL | null {
  const parsed = URL.parse(url);
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
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
  ['ff00::', 8], // multicast
] as const)
  refused.addSubnet(net, prefix, 'ipv6');

/** True unless `address` is a public unicast IP address; anything that is not an IP address is refused too. */
export function isRefusedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return refused.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Whether robots.txt lets ROBOTS_AGENT fetch `path` (path and query): the groups naming the agent, else `*`; the
 * longest matching rule wins, Allow on a tie (RFC 9309), with `*` and a trailing `$`. No group means allowed.
 */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  type Group = { agents: string[]; rules: { allow: boolean; pattern: string }[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      // Consecutive user-agent lines share one group.
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      // An empty Disallow allows everything: no rule.
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  const agent = ROBOTS_AGENT.toLowerCase();
  const named = groups.filter((g) => g.agents.includes(agent));
  const rules = (named.length ? named : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules) {
    if (!robotsMatch(rule.pattern, path)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  return best?.allow ?? true;
}

/**
 * A robots.txt pattern against a path, in linear time: no regular expression, since the site (the candidate) writes the
 * pattern and a backtracking `.*` chain would freeze the worker past any timeout. Leftmost matching of each `*`-separated
 * part is enough for globs with only `*`.
 */
function robotsMatch(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  const first = parts[0] ?? '';
  if (!path.startsWith(first)) return false;
  let at = first.length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] ?? '';
    const last = i === parts.length - 1;
    // The last part of an anchored pattern must end the path.
    const found = anchored && last ? path.length - part.length : path.indexOf(part, at);
    if (found < at || (anchored && last && !path.endsWith(part))) return false;
    at = found + part.length;
  }
  return !anchored || at === path.length;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

const squash = (text: string) => text.replace(/[ \t\f\v ]+/g, ' ').trim();

/**
 * The page's title and main text, readability-style: scripts, styles, navigation, headers, footers, asides and forms
 * are dropped; the first `<article>` or `<main>` is the text when there is one, else the body. One line per block.
 */
// shortcut: a linear scan of the markup, not a DOM (no HTML parser is installed): nested elements of a dropped kind and
// malformed markup can leave stray text. Add a parser if pilot pages show it.
export function extractPage(html: string): { title: string | null; text: string } {
  const lower = html.toLowerCase();
  const titleAt = /<title\b[^<>]*>/i.exec(html);
  const titleEnd = titleAt ? lower.indexOf('</title', titleAt.index) : -1;
  const title =
    titleAt && titleEnd >= 0 ? squash(decode(html.slice(titleAt.index + titleAt[0].length, titleEnd))) || null : null;
  let body = dropElements(html);
  const mainAt = /<(article|main)\b[^<>]*>/i.exec(body);
  const mainEnd = mainAt ? body.toLowerCase().indexOf(`</${mainAt[1]?.toLowerCase()}`, mainAt.index) : -1;
  if (mainAt && mainEnd >= 0) body = body.slice(mainAt.index + mainAt[0].length, mainEnd);
  const text = decode(
    body
      // [^<>] so an unclosed `<` stops at the next one: linear on a page of stray openers.
      .replace(/<(br|\/?(p|div|section|li|ul|ol|h[1-6]|tr|table|blockquote|pre|dd|dt|figcaption))\b[^<>]*>/gi, '\n')
      .replace(/<[^<>]*>/g, ' '),
  )
    .split('\n')
    .map(squash)
    .filter(Boolean)
    .join('\n');
  return { title, text };
}

const DROPPED = /<!--|<(head|script|style|noscript|template|svg|nav|header|footer|aside|form|iframe|select)\b/gi;

/**
 * The markup without comments and dropped elements, in one forward pass with `indexOf` for each closer (lazy regular
 * expressions rescan to the end from every unclosed opener: quadratic on 2 MB). A kind with no closer left is kept.
 */
function dropElements(html: string): string {
  const lower = html.toLowerCase();
  const unclosed = new Set<string>();
  let out = '';
  let at = 0;
  DROPPED.lastIndex = 0;
  for (let m = DROPPED.exec(html); m; m = DROPPED.exec(html)) {
    const close = m[1] ? `</${m[1].toLowerCase()}` : '-->';
    if (unclosed.has(close)) continue;
    const end = lower.indexOf(close, DROPPED.lastIndex);
    if (end < 0) {
      unclosed.add(close);
      continue;
    }
    const gt = m[1] ? lower.indexOf('>', end) : end + 2;
    out += html.slice(at, m.index) + ' ';
    at = gt < 0 ? html.length : gt + 1;
    DROPPED.lastIndex = at;
  }
  return out + html.slice(at);
}

/**
 * The link's one item: the page text, cited by the source label alone (no page), "Candidate-submitted", at most Medium,
 * with the document limit. Text a note flags is cut out, so mapping reads the page as if it were not there.
 */
// shortcut: one item holds the page's whole text (at most what 2 MB of HTML yields); split it into sections if mapping
// prompts for long pages grow too large.
export function linkItem(text: string, label: string, notes: readonly UnusualContent[]): DocumentItem | null {
  const excerpt = maskNotes(text, notes).replaceAll('\0', '').trim();
  if (!excerpt) return null;
  return { excerpt, excerptSpan: null, provenance: 'submitted', strength: 'medium', limit: documentLimit(label) };
}
