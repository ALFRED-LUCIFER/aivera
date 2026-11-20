import { Button } from '@aivera/ui';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { initials } from '@/features/shell/domain/shell.ts';
import type { OpsSection } from '../domain/ops.ts';

export type OpsSectionLink = { id: OpsSection; label: string; href?: Route | undefined };

export type OpsShellProps = {
  labels: {
    skipToContent: string;
    home: string;
    overview: string;
    nav: string;
    soon: string;
    later: string;
    signOut: string;
    operator: string;
    metadataOnly: string;
    theme: string;
  };
  /** The console's sections: a link where the section has a page, otherwise its label under "Coming later". */
  sections: readonly OpsSectionLink[];
  /** The section the current path is in, marked `aria-current="page"`; `home` for the overview. */
  activeId: string | undefined;
  /**
   * The signed-in operator's own name and email (AIV-P2-052), so the console always says who is acting. Only ever the
   * viewer's own; the list of operators is never shown (ADR-012 point 1).
   */
  operator?: { name: string; email: string } | undefined;
  onToggleTheme: () => void;
  /** The server action that ends the session and lands on the sign-in page. */
  signOutAction: () => Promise<void>;
  children: ReactNode;
};

const navItem = 'flex h-10 items-center gap-2.5 rounded-control px-2.5 pointer-coarse:min-h-11';
const navLink =
  `${navItem} font-medium text-text-2 transition-colors duration-120 ease-case motion-reduce:transition-none ` +
  'hover:bg-surface-subtle hover:text-text ' +
  'aria-[current=page]:bg-action aria-[current=page]:font-semibold aria-[current=page]:text-on-action';

const svg = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  className: 'size-4.5 flex-none',
} as const;

// One stroke weight, drawn to the recruiter shell's icon grid (24px, 1.75 stroke).
const icons: Record<OpsSection | 'home', ReactNode> = {
  home: <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />,
  workspaces: (
    <>
      <rect x="3.5" y="4" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="4" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="14" width="7" height="6" rx="1.5" />
      <rect x="13.5" y="14" width="7" height="6" rx="1.5" />
    </>
  ),
  approvals: (
    <>
      <path d="M8 4h8M8 4a2 2 0 0 0-2 2v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a2 2 0 0 0-2-2" />
      <path d="m9 13 2.2 2.2L15.5 11" />
    </>
  ),
  catalogue: (
    <>
      <path d="M5 4.5h10.5A3.5 3.5 0 0 1 19 8v11.5H8.5A3.5 3.5 0 0 1 5 16z" />
      <path d="M5 16a3.5 3.5 0 0 1 3.5-3.5H19M9 8h6" />
    </>
  ),
  requests: <path d="M4 6.5h16v10H9l-5 3.5zM8 10.5h8M8 13.5h5" />,
  subscriptions: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10h17M7 14.5h4" />
    </>
  ),
  deletions: <path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7M10.5 11v5M13.5 11v5" />,
};

const SectionIcon = ({ id }: { id: OpsSection | 'home' }) => <svg {...svg}>{icons[id]}</svg>;

/**
 * The operator console frame (AIV-P2-035, restyled in the console design pass): the Aivera mark with an "Operator" tag
 * so the console never reads as the recruiter app, the sections with icons and the current one in ink, the sections not
 * built yet under "Coming later", a standing reminder that the console holds platform metadata only (ADR-012 point 7),
 * and the signed-in operator with the theme switch and sign out. Under 1024px the sidebar sits above the page.
 */
export function OpsShell({
  labels,
  sections,
  activeId,
  operator,
  onToggleTheme,
  signOutAction,
  children,
}: OpsShellProps) {
  const built = sections.flatMap(({ href, ...section }) => (href ? [{ ...section, href }] : []));
  const later = sections.filter((section) => !section.href);
  const current = (id: string) => (id === activeId ? 'page' : undefined);
  return (
    <div className="min-h-screen bg-bg lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <a
        href="#content"
        className="sr-only rounded-control bg-action px-3 py-2 font-semibold text-on-action focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {labels.skipToContent}
      </a>
      <nav
        aria-label={labels.nav}
        className="flex flex-col gap-6 border-b border-border bg-surface px-3 py-4 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-e lg:border-b-0"
      >
        <div className="flex flex-col items-start gap-2 px-2.5 py-1">
          <p className="font-display text-section text-text">{labels.home}</p>
          {/* Says on every page that this is the operator console, not the recruiter app: ink, icon and word. */}
          <span className="inline-flex h-6 items-center gap-1.5 rounded-tag bg-action px-2 text-meta font-semibold text-on-action">
            <svg {...svg} className="size-3.5 flex-none">
              <path d="M12 3.5 5 6.5v5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9v-5z" />
            </svg>
            {labels.operator}
          </span>
        </div>
        <ul className="flex flex-col gap-0.5">
          <li>
            <Link href="/ops" aria-current={current('home')} className={navLink}>
              <SectionIcon id="home" />
              {labels.overview}
            </Link>
          </li>
          {built.map(({ id, label, href }) => (
            <li key={id}>
              <Link href={href} aria-current={current(id)} className={navLink}>
                <SectionIcon id={id} />
                {label}
              </Link>
            </li>
          ))}
        </ul>
        {later.length > 0 && (
          <div className="flex flex-col gap-1">
            <h2 className="px-2.5 text-meta font-semibold text-text-3">{labels.later}</h2>
            <ul className="flex flex-col gap-0.5">
              {later.map(({ id, label }) => (
                <li key={id} className={`${navItem} text-text-3`}>
                  <SectionIcon id={id} />
                  {label}
                  {/* The space keeps the accessible name "Requests Coming soon". */}{' '}
                  <span className="sr-only">{labels.soon}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
          <p className="flex gap-2 px-2.5 text-meta text-text-2">
            <svg {...svg} className="mt-px size-4 flex-none">
              <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
              <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
            </svg>
            {labels.metadataOnly}
          </p>
          {/* The identity slot: the signed-in operator (AIV-P2-052). */}
          {operator && (
            <div className="flex items-center gap-2.5 rounded-control bg-surface-subtle p-2.5">
              <span
                aria-hidden="true"
                className="grid size-9 flex-none place-items-center rounded-full bg-action text-meta font-semibold text-on-action"
              >
                {initials(operator.name) || '·'}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body font-semibold text-text">{operator.name}</span>
                <span className="truncate text-meta text-text-2" title={operator.email}>
                  {operator.email}
                </span>
              </span>
            </div>
          )}
          <div className="flex gap-1">
            <form action={signOutAction} className="grow">
              <button type="submit" className={`${navLink} w-full cursor-pointer`}>
                <svg {...svg}>
                  <path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4M10 16l4-4-4-4M14 12H4.5" />
                </svg>
                {labels.signOut}
              </button>
            </form>
            <Button variant="ghost" size="iconOnly" aria-label={labels.theme} onClick={onToggleTheme}>
              <svg {...svg}>
                <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5A6.5 6.5 0 0 1 12 3.5z" />
              </svg>
            </Button>
          </div>
        </div>
      </nav>
      <main id="content" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pt-8 pb-14 lg:px-10">
        {children}
      </main>
    </div>
  );
}
