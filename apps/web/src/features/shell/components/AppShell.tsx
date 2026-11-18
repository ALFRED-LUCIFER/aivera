import { useTranslations } from '@aivera/i18n/react';
import { AssistantDrawer, Button, Input, Label } from '@aivera/ui';
import Link from 'next/link';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { NavigationEntry, ScreenId } from '../domain/navigation.ts';
import type { Member, ShellCounts, Theme } from '../domain/shell.ts';

export type AppShellProps = {
  member: Member;
  /** null when the counts could not be read: the sections show without numbers. */
  counts: ShellCounts | null;
  /** The map entries this member may open. */
  screens: readonly NavigationEntry[];
  activeId: ScreenId | undefined;
  navOpen: boolean;
  onToggleNav: () => void;
  onCloseNav: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  onAssistantOpenChange: (open: boolean) => void;
  children: ReactNode;
};

const navLink =
  'flex h-10 items-center gap-2.5 rounded-control px-2.5 font-medium text-text-2 pointer-coarse:min-h-11 ' +
  'transition-colors duration-120 ease-case motion-reduce:transition-none hover:bg-surface-subtle hover:text-text ' +
  'aria-[current=page]:bg-action aria-[current=page]:font-semibold aria-[current=page]:text-on-action';

const icon = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, 'aria-hidden': true };

export function AppShell({
  member,
  counts,
  screens,
  activeId,
  navOpen,
  onToggleNav,
  onCloseNav,
  theme,
  onToggleTheme,
  onAssistantOpenChange,
  children,
}: AppShellProps) {
  const t = useTranslations('shell');
  const navId = useId();
  const searchId = useId();
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
  const activeLabel = activeId ? t(`nav.${activeId}`) : t('nav.label');
  return (
    // Under 1024px the grid falls away: header, then the opened menu, then the page stack in one column.
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
      <a
        href="#content"
        className="sr-only rounded-control bg-action px-3 py-2 font-semibold text-on-action focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
      >
        {t('skipToContent')}
      </a>
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3 lg:col-start-2 lg:px-8">
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
        <search className="min-w-0 flex-1 basis-64 sm:max-w-md">
          <Label htmlFor={searchId} className="sr-only">
            {t('search')}
          </Label>
          {/* shortcut: the field searches nothing yet; results arrive with AIV-P1-049. */}
          <Input id={searchId} type="search" placeholder={t('search')} />
        </search>
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
          <AssistantDrawer
            title={t('assistant.title')}
            context={t('assistant.context', { screen: activeLabel })}
            inputLabel={t('assistant.input')}
            askLabel={t('assistant.ask')}
            footer={t('assistant.footer')}
            closeLabel={t('assistant.close')}
            // shortcut: questions go nowhere yet; answers arrive with AIV-P2-028.
            onAsk={() => {}}
            onOpenChange={onAssistantOpenChange}
            trigger={<Button>{t('assistant.open')}</Button>}
          />
          <span className="grid size-9 place-items-center rounded-full border border-border bg-surface-subtle text-meta font-semibold text-text-2">
            <span aria-hidden="true">{member.initials}</span>
            <span className="sr-only">{t('account', { name: member.name })}</span>
          </span>
        </div>
      </header>
      <nav
        id={navId}
        aria-label={t('nav.label')}
        className={`${navOpen ? 'flex' : 'hidden'} flex-col gap-5 border-b border-border bg-surface px-3 py-4 lg:sticky lg:top-0 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:flex lg:h-screen lg:overflow-y-auto lg:border-e lg:border-b-0`}
      >
        <Link
          href="/app"
          onClick={onCloseNav}
          className="flex h-10 items-center px-2.5 font-display text-section text-text pointer-coarse:min-h-11"
        >
          {t('wordmark')}
        </Link>
        <ul ref={listRef} className="flex flex-col gap-0.5">
          {screens.map(({ id, path }) => (
            <li key={id}>
              <Link
                href={path}
                onClick={onCloseNav}
                aria-current={id === activeId ? 'page' : undefined}
                className={navLink}
              >
                {t(`nav.${id}`)}
                {counts?.[id] !== undefined && (
                  <>
                    {/* The space keeps the accessible name "Inbox 20", not "Inbox20". */}{' '}
                    <span className="ms-auto text-meta tabular-nums">{counts[id]}</span>
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-auto border-t border-border pt-3">
          <Link href="/" className={navLink}>
            {t('nav.website')}
          </Link>
        </div>
      </nav>
      <main id="content" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pt-6 pb-14 lg:col-start-2 lg:px-8">
        {children}
      </main>
    </div>
  );
}
