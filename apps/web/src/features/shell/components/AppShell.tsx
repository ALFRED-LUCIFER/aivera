// Deviation from the Main artboard: no "Credalent website" link in the sidebar footer (owner decision, 20 Nov 2026).
// Deviation (AIV-P1-165): an agency's sidebar adds "Clients" under the sections, each client linking to its jobs.
// Section counts only where a contract supplies a real one (AGENTS.md 1.7, AIV-P1-094): Interviews (AIV-P2-002).
import { useTranslations } from '@credalent/i18n/react';
import { Button } from '@credalent/ui';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { NavigationEntry, ScreenId } from '../domain/navigation.ts';
import type { Member, Theme } from '../domain/shell.ts';

export type AppShellProps = {
  member: Member;
  /** The map entries this member may open. */
  screens: readonly NavigationEntry[];
  /** A section's count beside its name: Interviews is the member's ongoing interviews. None, or zero, shows no count. */
  counts: Partial<Record<ScreenId, number>>;
  /** An agency's clients, each a link to its jobs (AIV-P1-165); null or absent for an in-house team: no Clients entry. */
  clients?: readonly { id: string; name: string }[] | null;
  activeId: ScreenId | undefined;
  navOpen: boolean;
  onToggleNav: () => void;
  onCloseNav: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  /** The server action that ends the session and lands on the sign-in page. */
  signOutAction: () => Promise<void>;
  /** The top-bar search (AIV-P1-049), composed by the app. */
  search: ReactNode;
  children: ReactNode;
};

const navLink =
  'flex h-10 items-center gap-2.5 rounded-control px-2.5 font-medium text-text-2 pointer-coarse:min-h-11 ' +
  'transition-colors duration-120 ease-case motion-reduce:transition-none hover:bg-surface-subtle hover:text-text ' +
  'aria-[current=page]:bg-action aria-[current=page]:font-semibold aria-[current=page]:text-on-action';

const icon = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, 'aria-hidden': true };

export function AppShell({
  member,
  screens,
  counts,
  clients,
  activeId,
  navOpen,
  onToggleNav,
  onCloseNav,
  theme,
  onToggleTheme,
  signOutAction,
  search,
  children,
}: AppShellProps) {
  const t = useTranslations('shell');
  const navId = useId();
  const menuRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // The opened menu takes focus, so keyboard users land in it rather than behind it.
  useEffect(() => {
    if (navOpen) listRef.current?.querySelector('a')?.focus();
  }, [navOpen]);
  // Escape closes the opened menu and returns focus to its button.
  useEffect(() => {
    if (!navOpen) return;
    const close = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onCloseNav();
      menuRef.current?.focus();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [navOpen, onCloseNav]);
  const foot = screens.filter((screen) => 'foot' in screen);
  const sections = screens.filter((screen) => !('foot' in screen));
  return (
    // Under 1024px the grid falls away: header, then the opened menu, then the page stack in one column.
    // Printed, only the page is: no top bar or sidebar (AIV-P1-165).
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] print:block">
      <a
        href="#content"
        className="sr-only rounded-control bg-action px-3 py-2 font-semibold text-on-action focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 print:hidden"
      >
        {t('skipToContent')}
      </a>
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:col-start-2 lg:px-8 print:hidden">
        <Button
          variant="ghost"
          size="iconOnly"
          ref={menuRef}
          className="lg:hidden"
          aria-label={navOpen ? t('nav.close') : t('nav.open')}
          aria-expanded={navOpen}
          aria-controls={navId}
          onClick={onToggleNav}
        >
          <svg {...icon} className="size-5">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </Button>
        {/* Deviation from the Main artboard: no "Ask Credalent" until the assistant works (AIV-P2-E06); AIV-P1-095. */}
        <search className="min-w-0 flex-1 basis-64 sm:max-w-md">{search}</search>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {member.workspace.synthetic && (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-tag border border-info-border bg-info-bg px-2 text-meta font-semibold text-info-text">
              <svg {...icon} className="size-4">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5M12 8h.01" />
              </svg>
              {t('synthetic')}
            </span>
          )}
          <Button
            variant="ghost"
            size="iconOnly"
            aria-label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
            onClick={onToggleTheme}
          >
            <svg {...icon} className="size-5">
              <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
            </svg>
          </Button>
          <span className="grid size-9 place-items-center rounded-full border border-border bg-surface-subtle text-meta font-semibold text-text-2">
            <span aria-hidden="true">{member.initials}</span>
            <span className="sr-only">{t('account', { name: member.name })}</span>
          </span>
        </div>
      </header>
      <nav
        id={navId}
        aria-label={t('nav.label')}
        className={`${navOpen ? 'flex' : 'hidden'} flex-col gap-5 border-b border-border bg-surface px-3 py-4 lg:sticky lg:top-0 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:flex lg:h-screen lg:overflow-y-auto lg:border-e lg:border-b-0 print:hidden`}
      >
        <Link
          href="/app"
          onClick={onCloseNav}
          className="flex h-10 items-center gap-2.5 px-2.5 font-display text-section text-text pointer-coarse:min-h-11"
        >
          <Image
            src="/brand/credalent-mark.png"
            alt=""
            width={30}
            height={30}
            className="rounded-lg ring-1 ring-border-strong"
          />
          {t('wordmark')}
        </Link>
        <ul ref={listRef} className="flex flex-col gap-0.5">
          {sections.map(({ id, path }) => (
            <li key={id}>
              <Link
                href={path}
                onClick={onCloseNav}
                aria-current={id === activeId ? 'page' : undefined}
                className={navLink}
              >
                {t(`nav.${id}`)}
                {counts[id] !== undefined && (
                  // The space keeps the link's name "Interviews 5" for assistive technology.
                  <>
                    {' '}
                    <span className="ms-auto text-meta tabular-nums">{counts[id]}</span>
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {clients && (
          <div className="flex flex-col gap-0.5">
            <Link href="/app/settings/clients" onClick={onCloseNav} className={navLink}>
              {t('nav.clients')}
            </Link>
            <ul className="flex flex-col gap-0.5 ps-3">
              {clients.map(({ id, name }) => (
                <li key={id}>
                  {/* The client's opaque id, never its name, goes in the URL. */}
                  <Link href={`/app/jobs?client=${id}`} onClick={onCloseNav} className={navLink}>
                    {name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-auto border-t border-border pt-3">
          {foot.map(({ id, path }) => (
            <Link
              key={id}
              href={path}
              onClick={onCloseNav}
              aria-current={id === activeId ? 'page' : undefined}
              className={navLink}
            >
              {t(`nav.${id}`)}
            </Link>
          ))}
          <form action={signOutAction}>
            <button type="submit" className={`${navLink} w-full cursor-pointer`}>
              {t('signOut')}
            </button>
          </form>
        </div>
      </nav>
      <main id="content" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pt-6 pb-14 lg:col-start-2 lg:px-8">
        {/* AIV-P2-037: the operator's reason is never shown to members; the server refuses new work on its own. */}
        {member.workspace.status === 'suspended' && (
          <p className="mb-6 flex items-start gap-2 rounded-card border border-warn-border bg-warn-bg p-4 text-body text-warn-text">
            <svg {...icon} className="mt-0.5 size-5 shrink-0">
              <rect x="7" y="5" width="3" height="14" rx="1" />
              <rect x="14" y="5" width="3" height="14" rx="1" />
            </svg>
            {t('paused')}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
