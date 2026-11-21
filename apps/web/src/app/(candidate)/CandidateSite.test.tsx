// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CandidateSite } from './CandidateSite.tsx';

let pathname = '/candidates';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
afterEach(() => {
  cleanup(); // Vitest globals are off, so Testing Library cannot register its own cleanup.
  pathname = '/candidates';
});

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const renderSite = (signedIn: boolean) =>
  render(
    <CandidateSite intl={intl} signedIn={signedIn} signOutAction={signOut}>
      <p>Page body</p>
    </CandidateSite>,
  );
const signOut = vi.fn(async () => undefined);
const header = () => within(screen.getByRole('banner'));

describe('CandidateSite', () => {
  it('shows the candidate navigation and Create account when signed out', () => {
    renderSite(false);
    expect(header().getByRole('link', { name: /^Credalent for candidates/ })).toHaveProperty('pathname', '/candidates');
    const nav = within(screen.getByRole('navigation', { name: 'Candidate site' }));
    expect(nav.getAllByRole('link').map((link) => link.textContent)).toEqual(['Jobs', 'Create account']);
    expect(screen.queryByRole('link', { name: 'My applications' })).toBeNull();
  });

  // mutation check: swapped the signedIn branch in CandidateShell -> both header tests failed
  it('shows no Create account and no unbuilt My applications link when signed in', () => {
    renderSite(true);
    expect(screen.queryByRole('link', { name: 'My applications' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create account' })).toBeNull();
    expect(header().getByRole('button', { name: 'Sign out' })).toBeDefined();
  });

  it('offers Sign out only when signed in', () => {
    renderSite(false);
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('states the ranking rule and links Jobs and For recruiters in the footer', () => {
    renderSite(false);
    const footer = within(screen.getByRole('contentinfo'));
    expect(footer.getByText('© 2026 Credalent. Paying never changes how recruiters rank you.')).toBeDefined();
    expect(footer.getAllByRole('link').map((link) => link.textContent)).toEqual(['Jobs', 'For recruiters']);
  });

  it('marks the current section, including the pages under it', () => {
    pathname = '/candidates/jobs/qa-lead';
    renderSite(false);
    const nav = within(screen.getByRole('navigation', { name: 'Candidate site' }));
    expect(nav.getByRole('link', { name: 'Jobs' }).getAttribute('aria-current')).toBe('page');
  });

  it('carries none of the recruiter chrome', () => {
    renderSite(false);
    expect(screen.queryByRole('button', { name: 'Ask Credalent' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
    expect(screen.queryByText('Synthetic demo data')).toBeNull();
  });

  it('opens the menu from the keyboard, focuses its first link, and Escape closes it back to the button', async () => {
    const user = userEvent.setup();
    renderSite(false);
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    menu.focus();
    await user.keyboard('{Enter}');
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(
      within(screen.getByRole('navigation', { name: 'Candidate site' })).getByRole('link', { name: 'Jobs' }),
    );
    await user.keyboard('{Escape}');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu);
  });

  it('puts Skip to content first and points it at main', () => {
    renderSite(false);
    const first = screen.getAllByRole('link')[0];
    expect(first?.textContent).toBe('Skip to content');
    expect(first?.getAttribute('href')).toBe('#content');
    expect(screen.getByRole('main').id).toBe('content');
  });
});
