// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { canOpen, navigation } from '@/features/shell/domain/navigation.ts';
import type { Member } from '@/features/shell/domain/shell.ts';
import { RecruiterShell } from './RecruiterShell.tsx';

let pathname = '/app';
const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push }) }));
// AIV-P1-049: the search action, faked; its reads and logging are tested in features/search/services.
const search = vi.fn();
vi.mock('@/features/search/services/searchWorkspace.ts', () => ({
  searchWorkspace: (input: unknown) => search(input),
}));
const setTheme = vi.fn(async (_theme: string) => {});
vi.mock('@/features/shell/services/theme.ts', () => ({ setTheme: (theme: string) => setTheme(theme) }));
const signOut = vi.fn(async () => {});
vi.mock('@/features/sign-in/services/signOut.ts', () => ({ signOut: () => signOut() }));

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
  capabilities: ['member', 'recruiter'],
  workspace: { synthetic: true, status: 'active' },
};
// What the layout passes: no flag is on, so only built sections.
const built = navigation.filter((entry) => canOpen(entry, ['member', 'recruiter'], new Set()));

const renderShell = ({
  synthetic = true,
  status = 'active' as Member['workspace']['status'],
  clients = null as { id: string; name: string }[] | null,
} = {}) =>
  render(
    <RecruiterShell
      intl={intl}
      theme="light"
      member={{ ...member, workspace: { synthetic, status } }}
      screens={built}
      counts={{ interviews: 5 }}
      clients={clients}
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
  it('Scenario: The sidebar shows the built sections, and a count only where one is supplied (AIV-P2-002)', () => {
    renderShell();
    expect(sectionNames()).toEqual(['Credalent', 'My desk', 'Jobs', 'Candidates', 'Interviews 5', 'Settings']);
    expect(within(sidebar()).getByRole('link', { name: 'My desk' }).getAttribute('aria-current')).toBe('page');
    expect(sidebar().querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    // The Main artboard draws the Credalent mark beside the wordmark (AIV-P0-035).
    expect(
      within(sidebar()).getByRole('link', { name: 'Credalent' }).querySelector('img')?.getAttribute('src'),
    ).toContain('credalent-mark');
    // Owner decision (20 Nov 2026): the recruiter app never links out to the website.
    expect(screen.queryByRole('link', { name: /website/i })).toBeNull();
    expect(document.querySelector('a[href="/"]')).toBeNull();
  });

  // AIV-P1-165 "Agencies have a Clients entry": each client links to Jobs filtered by its opaque id, never its name.
  it('Scenario: an agency sidebar lists its clients; an in-house team has no Clients entry', () => {
    renderShell({
      clients: [
        { id: '0190d4a2-0000-7000-9000-00000000c001', name: 'Dune Logistics' },
        { id: '0190d4a2-0000-7000-9000-00000000c002', name: 'Falcon Pay' },
      ],
    });
    expect(sectionNames()).toEqual([
      'Credalent',
      'My desk',
      'Jobs',
      'Candidates',
      'Interviews 5',
      'Clients',
      'Dune Logistics',
      'Falcon Pay',
      'Settings',
    ]);
    expect(within(sidebar()).getByRole('link', { name: 'Falcon Pay' }).getAttribute('href')).toBe(
      '/app/jobs?client=0190d4a2-0000-7000-9000-00000000c002',
    );
    cleanup();
    renderShell();
    expect(within(sidebar()).queryByRole('link', { name: 'Clients' })).toBeNull();
  });

  // Scenario: Sign out (the cookie and the redirect are proven end to end in tests/e2e/src/sign-in.spec.ts).
  it('Sign out in the sidebar calls the sign-out action', async () => {
    renderShell();
    await userEvent.click(within(sidebar()).getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });

  it('marks the section of a nested page as current', () => {
    pathname = '/app/jobs/42/pack';
    renderShell();
    expect(within(sidebar()).getByRole('link', { name: 'Jobs' }).getAttribute('aria-current')).toBe('page');
    expect(within(sidebar()).getByRole('link', { name: 'My desk' }).getAttribute('aria-current')).toBeNull();
  });

  // SAFETY: mutation check: rendered the badge without the synthetic check -> this test failed
  it('Scenario: The synthetic data badge is always visible on demo data', () => {
    renderShell();
    expect(within(screen.getByRole('banner')).getByText('Synthetic demo data')).toBeTruthy();
    cleanup();
    renderShell({ synthetic: false });
    expect(screen.queryByText('Synthetic demo data')).toBeNull();
  });

  it('Scenario: Members of a suspended workspace can read but not start work: the banner, and never the reason', () => {
    const banner = 'This workspace is paused by Credalent. You can read everything. New work is paused.';
    renderShell({ status: 'suspended' });
    expect(within(screen.getByRole('main')).getByText(banner)).toBeTruthy();
    expect(screen.getByText('Page body')).toBeTruthy();
    cleanup();
    renderShell();
    expect(screen.queryByText(banner)).toBeNull();
  });

  it('Scenario: the top bar has the search; the assistant stays absent until it works', () => {
    renderShell();
    expect(screen.getByRole('button', { name: 'Search jobs and candidates' }).getAttribute('aria-keyshortcuts')).toBe(
      '/',
    );
    expect(screen.queryByRole('button', { name: /^Ask/ })).toBeNull();
  });

  // AIV-P1-049, synthetic cast only.
  it('Scenario: Find a candidate, from "/", and No results', async () => {
    search.mockImplementation(async ({ query }: { query: string }) =>
      query === 'Sara'
        ? {
            jobs: [],
            candidates: [
              { personId: 'p1', name: 'Sara Al Qahtani', job: 'Senior AI Engineer', href: '/app/candidates/p1?job=j1' },
            ],
          }
        : { jobs: [], candidates: [] },
    );
    renderShell();
    await userEvent.keyboard('/');
    const box = await screen.findByRole('searchbox', { name: 'Search jobs and candidates' });
    // Focus is in the box: the keystrokes go wherever focus is.
    await userEvent.keyboard('Sara');
    expect(box).toHaveProperty('value', 'Sara');
    const dialog = screen.getByRole('dialog', { name: 'Search' });
    expect(
      (await within(dialog).findByRole('link', { name: 'Sara Al Qahtani · Senior AI Engineer' })).getAttribute('href'),
    ).toBe('/app/candidates/p1?job=j1');
    expect(within(dialog).getByRole('heading', { name: 'Candidates' })).toBeTruthy();
    expect(search).toHaveBeenLastCalledWith({ query: 'Sara' });
    await userEvent.clear(box);
    await userEvent.type(box, 'zzzz');
    expect(await within(dialog).findByText('Nothing found for zzzz')).toBeTruthy();
  });

  it('Scenario: Keyboard use: Enter opens the first result', async () => {
    search.mockResolvedValue({
      jobs: [{ id: 'j3', title: 'QA Automation Engineer', href: '/app/jobs/j3' }],
      candidates: [],
    });
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'Search jobs and candidates' }));
    await userEvent.keyboard('QA');
    expect(screen.getByRole('searchbox')).toHaveProperty('value', 'QA');
    await screen.findByRole('link', { name: 'QA Automation Engineer' });
    await userEvent.keyboard('{Enter}');
    expect(push).toHaveBeenCalledWith('/app/jobs/j3');
    expect(screen.queryByRole('dialog')).toBeNull();
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
    await userEvent.click(within(sidebar()).getByRole('link', { name: 'Jobs' }));
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });

  // SAFETY: mutation check: removed the focus effect -> this test failed; removed the Escape handler -> this test failed
  it('the opened menu takes focus, and Escape closes it with focus back on the menu button', async () => {
    renderShell();
    const menu = screen.getByRole('button', { name: 'Open navigation' });
    await userEvent.click(menu);
    expect(document.activeElement).toBe(within(sidebar()).getByRole('link', { name: 'My desk' }));
    await userEvent.keyboard('{Escape}');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu);
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

  it('has the landmarks: banner, named navigation and main', () => {
    renderShell();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(sidebar()).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByText('Signed in as AP')).toBeTruthy();
  });
});
