import { SLUG } from '@credalent/jobs';

// URLs from docs/01-design/screens.md; each page arrives with its own ticket (AIV-P3-004, -010, -012, AIV-P4).
export const headerLinks = [
  { key: 'jobs', href: '/candidates/jobs' },
  { key: 'cvCheck', href: '/candidates/cv-check' },
  { key: 'plans', href: '/candidates/plans' },
  { key: 'portfolio', href: '/candidates/plus/address' },
] as const;

export const accountLink = {
  signedOut: { key: 'createAccount', href: '/candidates/signup' },
  signedIn: { key: 'myApplications', href: '/candidates/me' },
} as const;

// "For recruiters" goes to the marketing site, which is the root page until AIV-P5-E01 builds it.
export const footerLinks = [
  { key: 'jobs', href: '/candidates/jobs' },
  { key: 'plans', href: '/candidates/plans' },
  { key: 'forRecruiters', href: '/' },
] as const;

/** A link is current on its own page and the pages under it (`/candidates/jobs/[slug]` keeps "Jobs" current). */
export const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

type PageKey =
  | `nav.${(typeof headerLinks)[number]['key']}`
  | (typeof accountLink)[keyof typeof accountLink]['key']
  | 'applyPlaceholder';
/** The catalogue key naming each of the site's own pages the frame links to (placeholders until their tickets). */
export const sitePages = new Map<string, PageKey>([
  ...headerLinks.map(({ key, href }) => [href, `nav.${key}`] as const),
  ...Object.values(accountLink).map(({ key, href }) => [href, key] as const),
]);

/** A job's apply address, linked from its page (AIV-P3-005); the form itself is AIV-P3-008. */
export const applyHref = (slug: string) => `/candidates/jobs/${slug}/apply` as const;

/** The free CV check with this job chosen (AIV-P3-005); reading `job` is AIV-P3-010's. */
export const cvCheckHref = (slug: string) => `/candidates/cv-check?job=${slug}` as const;

const APPLY_PATH = new RegExp(`^/candidates/jobs/(?:${SLUG.source.slice(1, -1)})/apply$`);

/** The placeholder a path shows, if it is one of the site's pages not built yet; the apply form counts. */
export const placeholderKey = (path: string): PageKey | undefined =>
  sitePages.get(path) ?? (APPLY_PATH.test(path) ? 'applyPlaceholder' : undefined);
