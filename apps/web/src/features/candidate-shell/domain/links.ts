// URLs from docs/01-design/screens.md. Only built pages are linked (AIV-P1-095); CV check, Plans, Portfolio, Apply and
// My applications join when their tickets (AIV-P3-004, -008, -010, -012, AIV-P4) ship.
export const headerLinks = [{ key: 'jobs', href: '/candidates/jobs' }] as const;

export const accountLink = { key: 'createAccount', href: '/candidates/signup' } as const;

// "For recruiters" goes to the marketing site, which is the root page until AIV-P5-E01 builds it.
export const footerLinks = [
  { key: 'jobs', href: '/candidates/jobs' },
  { key: 'forRecruiters', href: '/' },
] as const;

/** A link is current on its own page and the pages under it (`/candidates/jobs/[slug]` keeps "Jobs" current). */
export const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
