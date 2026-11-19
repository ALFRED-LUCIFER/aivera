import { useTranslations } from '@aivera/i18n/react';
import { Button, buttonClassName } from '@aivera/ui';
import Link from 'next/link';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { accountLink, footerLinks, headerLinks, isCurrent } from '../domain/links.ts';

export type CandidateShellProps = {
  signedIn: boolean;
  pathname: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  children: ReactNode;
};

// The artboard's .wlink: an ink underline draws in from the start edge on hover and stays under the current page, which
// is also set in weight, so it never rests on colour alone.
const navLink =
  'inline-flex min-h-11 items-center px-1.5 font-medium text-text-2 hover:text-text ' +
  'bg-[linear-gradient(currentColor,currentColor)] bg-no-repeat bg-position-[6px_calc(100%-10px)] rtl:bg-position-[calc(100%-6px)_calc(100%-10px)] bg-size-[0_1.5px] ' +
  'transition-[background-size,color] duration-240 ease-case hover:bg-size-[calc(100%-12px)_1.5px] motion-reduce:transition-none ' +
  'aria-[current=page]:font-semibold aria-[current=page]:text-text aria-[current=page]:bg-size-[calc(100%-12px)_1.5px]';

// The artboard's 1120 px column with fluid gutters.
const container = 'mx-auto w-full max-w-280 px-[clamp(20px,4vw,40px)]';

export function CandidateShell({
  signedIn,
  pathname,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  children,
}: CandidateShellProps) {
  const t = useTranslations('candidate.shell');
  const menuId = useId();
  const menuRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // The opened menu takes focus, so keyboard users land in it rather than behind it.
  useEffect(() => {
    if (menuOpen) listRef.current?.querySelector('a')?.focus();
  }, [menuOpen]);
  // Escape closes the opened menu and returns focus to its button.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onCloseMenu();
      menuRef.current?.focus();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen, onCloseMenu]);
  const account = signedIn ? accountLink.signedIn : accountLink.signedOut;
  const current = (href: string) => (isCurrent(pathname, href) ? 'page' : undefined);
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#content"
        className="sr-only rounded-control bg-action px-3 py-2 font-semibold text-on-action focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {t('skipToContent')}
      </a>
      <header className="border-b border-border bg-surface">
        <div className={`${container} flex flex-wrap items-center gap-x-6 gap-y-2 py-3`}>
          <Link href="/candidates" className="flex min-h-11 items-center gap-2.5 rounded-control">
            <span className="font-display text-[20px] font-bold tracking-tight text-text">{t('wordmark')}</span>{' '}
            <span className="border-s border-border-strong ps-2.5 text-meta text-text-2">{t('audience')}</span>
          </Link>
          <Button
            variant="ghost"
            ref={menuRef}
            className="ms-auto md:hidden"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={onToggleMenu}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              aria-hidden
              className="size-5"
            >
              <path d={menuOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} />
            </svg>
            {t('nav.menu')}
          </Button>
          {/* Under 768px the links drop below the wordmark, shown only while the menu is open. */}
          <nav
            id={menuId}
            aria-label={t('nav.label')}
            className={`${menuOpen ? 'flex' : 'hidden'} basis-full flex-col gap-3 pb-2 md:flex md:flex-1 md:basis-auto md:flex-row md:items-center md:pb-0`}
          >
            <ul ref={listRef} className="flex flex-col md:mx-auto md:flex-row md:flex-wrap md:gap-x-4">
              {headerLinks.map(({ key, href }) => (
                <li key={key}>
                  <Link href={href} onClick={onCloseMenu} aria-current={current(href)} className={navLink}>
                    {t(`nav.${key}`)}
                  </Link>
                </li>
              ))}
            </ul>
            {/* Secondary, not primary: the page below owns the one primary action (DESIGN.md). */}
            <Link
              href={account.href}
              onClick={onCloseMenu}
              aria-current={current(account.href)}
              className={`${buttonClassName('secondary')} self-start md:self-auto`}
            >
              {t(account.key)}
            </Link>
          </nav>
        </div>
      </header>
      <main id="content" tabIndex={-1} className={`${container} flex-1 pt-[clamp(24px,4vw,48px)] pb-16`}>
        {children}
      </main>
      <footer className="border-t border-border">
        <div className={`${container} flex flex-col gap-3 py-6 md:flex-row md:items-center md:justify-between`}>
          <p className="text-meta text-text-2">{t('footer.rule')}</p>
          <nav aria-label={t('footer.label')}>
            <ul className="-mx-1.5 flex flex-wrap gap-x-4">
              {footerLinks.map(({ key, href }) => (
                <li key={key}>
                  <Link href={href} className={navLink}>
                    {t(`footer.${key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
