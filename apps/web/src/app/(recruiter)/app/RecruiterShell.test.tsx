// @vitest-environment jsdom
import { intlConfig } from '@aivera/i18n';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigation } from '@/features/shell/domain/navigation.ts';
import type { Member, ShellCounts } from '@/features/shell/domain/shell.ts';
import { RecruiterShell } from './RecruiterShell.tsx';

let pathname = '/app';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
const setTheme = vi.fn(async (_theme: string) => {});
vi.mock('@/features/shell/services/theme.ts', () => ({ setTheme: (theme: string) => setTheme(theme) }));

beforeEach(() => {
  pathname = '/app';
});
afterEach(cleanup); // Vitest globals are off, so Testing Library cannot register its own cleanup.

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const member: Member = {
  name: 'AP',
  initials: 'AP',
  capabilities: ['recruiter'],
  workspace: { synthetic: true },
};
const seed: ShellCounts = { desk: 4, inbox: 20, jobs: 5, interviews: 5, packs: 1 };

const renderShell = ({ counts = seed as ShellCounts | null, synthetic = true } = {}) =>
  render(
    <RecruiterShell
      intl={intl}
      theme="light"
      member={{ ...member, workspace: { synthetic } }}
      counts={counts}
      screens={navigation}
    >
      <p>Page body</p>
    </RecruiterShell>,
  );

const sidebar = () => screen.getByRole('navigation', { name: 'Primary' });
const sectionNames = () =>
  within(sidebar())
    .getAllByRole('link')
    .map((link) => link.textContent);

describe('Recruiter app shell', () => {
  // SAFETY: mutation check: aria-current compared against undefined -> this test failed
  it('Scenario: The sidebar shows every section with its count', () => {
    renderShell();
    for (const name of [
      'My desk 4',
      'Inbox 20',
      'Jobs 5',
      'Candidates',
      'Talent pool',
      'Interviews 5',
      'Decision packs 1',
      'Value dashboard',
    ])
      expect(within(sidebar()).getByRole('link', { name })).toBeTruthy();
    expect(within(sidebar()).getByRole('link', { name: 'My desk 4' }).getAttribute('aria-current')).toBe('page');
    expect(sidebar().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Aivera website' }).getAttribute('href')).toBe('/');
  });

  it('marks the section of a nested page as current', () => {
    pathname = '/app/jobs/42/pack';
    renderShell();
    expect(within(sidebar()).getByRole('link', { name: 'Jobs 5' }).getAttribute('aria-current')).toBe('page');
    expect(within(sidebar()).getByRole('link', { name: 'My desk 4' }).getAttribute('aria-current')).toBeNull();
  });

  // SAFETY: mutation check: rendered the badge without the synthetic check -> this test failed
  it('Scenario: The synthetic data badge is always visible on demo data', () => {
    renderShell();
    expect(within(screen.getByRole('banner')).getByText('Synthetic demo data')).toBeTruthy();
    cleanup();
    renderShell({ synthetic: false });
    expect(screen.queryByText('Synthetic demo data')).toBeNull();
  });

  // SAFETY: mutation check: removed the question-field focus in onAssistantOpenChange -> this test failed
  it('Scenario: Ask Aivera opens the assistant drawer', async () => {
    renderShell();
    const ask = screen.getByRole('button', { name: 'Ask Aivera' });
    await userEvent.click(ask);
    const drawer = screen.getByRole('dialog', { name: 'Aivera assistant' });
    expect(within(drawer).getByText('Context: My desk')).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(drawer).getByRole('textbox', { name: 'Ask about what is on this page' }),
      ),
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(ask);
  });

  it('Scenario: Keyboard users can skip the navigation', async () => {
    renderShell();
    await userEvent.tab();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(document.activeElement).toBe(skip);
    const main = screen.getByRole('main');
    // The browser moves focus to the fragment target; tabIndex -1 is what makes <main> focusable for it.
    expect(skip.getAttribute('href')).toBe(`#${main.id}`);
    expect(main.tabIndex).toBe(-1);
    expect(main.textContent).toBe('Page body');
  });

  // SAFETY: mutation check: nav always "flex" -> this test failed
  it('Scenario: Narrow screens collapse the sidebar', async () => {
    renderShell();
    const menu = screen.getByRole('button', { name: 'Open navigation' });
    // jsdom has no layout: assert the classes that hide the nav under lg (1024px) and the button above it.
    expect(menu.className).toContain('lg:hidden');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('aria-controls')).toBe(sidebar().id);
    expect(sidebar().className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(sidebar().className).toContain('lg:flex');
    await userEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('aria-label')).toBe('Close navigation');
    expect(sidebar().className).not.toMatch(/(^|\s)hidden(\s|$)/);
    await userEvent.click(within(sidebar()).getByRole('link', { name: 'Inbox 20' }));
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });

  // SAFETY: mutation check: removed the focus effect -> this test failed; removed the Escape handler -> this test failed
  it('the opened menu takes focus, and Escape closes it with focus back on the menu button', async () => {
    renderShell();
    const menu = screen.getByRole('button', { name: 'Open navigation' });
    await userEvent.click(menu);
    expect(document.activeElement).toBe(within(sidebar()).getByRole('link', { name: 'My desk 4' }));
    await userEvent.keyboard('{Escape}');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu);
  });

  it('Scenario: Counts fail softly', () => {
    renderShell({ counts: null });
    expect(sectionNames()).toEqual([
      'Aivera',
      'My desk',
      'Inbox',
      'Jobs',
      'Candidates',
      'Talent pool',
      'Interviews',
      'Decision packs',
      'Value dashboard',
      'Aivera website',
    ]);
    expect(screen.getByRole('main').textContent).toBe('Page body');
  });

  it('switches the theme on <html> at once and stores it in the cookie', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
  });

  // SAFETY: mutation check: dropped the .catch revert in onToggleTheme -> this test failed
  it('puts the theme back when saving it fails', async () => {
    setTheme.mockRejectedValueOnce(new Error('offline'));
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('light'));
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeTruthy();
  });

  it('has the landmarks: banner, named navigation, main and search', () => {
    renderShell();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(sidebar()).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    // aria-query predates <search>; browsers give it the search landmark role.
    expect(
      screen.getByRole('searchbox', { name: 'Search roles, candidates and evidence' }).closest('search'),
    ).toBeTruthy();
    expect(screen.getByText('Signed in as AP')).toBeTruthy();
  });
});
