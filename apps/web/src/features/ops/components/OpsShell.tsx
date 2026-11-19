import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

export type OpsShellProps = {
  labels: { skipToContent: string; home: string; nav: string; soon: string; signOut: string };
  /** The console's sections: a link where the section has a page, otherwise its label and "Coming soon". */
  sections: readonly { label: string; href?: Route | undefined }[];
  /** The server action that ends the session and lands on the sign-in page. */
  signOutAction: () => Promise<void>;
  children: ReactNode;
};

const navItem = 'flex h-10 items-center gap-2.5 rounded-control px-2.5 pointer-coarse:min-h-11';
const navLink =
  `${navItem} font-medium text-text-2 transition-colors duration-120 ease-case motion-reduce:transition-none ` +
  'hover:bg-surface-subtle hover:text-text';

/**
 * The operator console frame (AIV-P2-035), on the recruiter shell's layout and tokens: skip link, sidebar, main. Under
 * 1024px the sidebar sits above the page. Not linked from the recruiter app or the candidate site.
 */
export function OpsShell({ labels, sections, signOutAction, children }: OpsShellProps) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#content"
        className="sr-only rounded-control bg-action px-3 py-2 font-semibold text-on-action focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {labels.skipToContent}
      </a>
      <nav
        aria-label={labels.nav}
        className="flex flex-col gap-5 border-b border-border bg-surface px-3 py-4 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-e lg:border-b-0"
      >
        <Link href="/ops" className={`${navItem} font-display text-section text-text`}>
          {labels.home}
        </Link>
        <ul className="flex flex-col gap-0.5">
          {sections.map(({ label, href }) =>
            href ? (
              <li key={label}>
                <Link href={href} className={navLink}>
                  {label}
                </Link>
              </li>
            ) : (
              <li key={label} className={`${navItem} text-text-2`}>
                {label}
                {/* The space keeps the accessible name "Approvals Coming soon". */}{' '}
                <span className="ms-auto text-meta">{labels.soon}</span>
              </li>
            ),
          )}
        </ul>
        <form action={signOutAction} className="mt-auto border-t border-border pt-3">
          <button type="submit" className={`${navLink} w-full cursor-pointer`}>
            {labels.signOut}
          </button>
        </form>
      </nav>
      <main id="content" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pt-6 pb-14 lg:px-8">
        {children}
      </main>
    </div>
  );
}
