// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OpsShell, type OpsShellProps } from './OpsShell.tsx';

// AIV-P2-040, AIV-P2-052: the console frame. Synthetic operator (personas.md).
afterEach(cleanup);

const labels: OpsShellProps['labels'] = {
  skipToContent: 'Skip to content',
  home: 'Credalent operations',
  overview: 'Overview',
  nav: 'Operations',
  soon: 'Coming soon',
  later: 'Coming later',
  signOut: 'Sign out',
  operator: 'Operator',
  metadataOnly: 'Platform metadata only. Candidate data never appears here.',
  theme: 'Switch to dark theme',
};
const show = (props: Partial<OpsShellProps> = {}) =>
  render(
    <OpsShell
      labels={labels}
      sections={[
        { id: 'workspaces', label: 'Workspaces', href: '/ops/workspaces' },
        { id: 'requests', label: 'Requests' },
      ]}
      activeId="workspaces"
      onToggleTheme={() => {}}
      signOutAction={async () => {}}
      {...props}
    >
      <p>Page</p>
    </OpsShell>,
  );

describe('The console shell', () => {
  it('marks the current section and lists unbuilt sections under "Coming later", not as links', () => {
    show();
    const nav = screen.getByRole('navigation', { name: 'Operations' });
    expect(within(nav).getByRole('link', { name: 'Workspaces' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();
    expect(within(nav).queryByRole('link', { name: /Requests/ })).toBeNull();
    expect(within(nav).getByText('Coming later')).toBeTruthy();
  });

  it('shows the signed-in operator: name, email and the Operator tag, above Sign out', () => {
    show({ operator: { name: 'Pia Platform', email: 'pia.platform@example.com' } });
    const nav = screen.getByRole('navigation', { name: 'Operations' });
    expect(within(nav).getByText('Pia Platform')).toBeTruthy();
    expect(within(nav).getByText('pia.platform@example.com')).toBeTruthy();
    expect(within(nav).getByText('Operator')).toBeTruthy();
    const text = nav.textContent ?? '';
    expect(text.indexOf('pia.platform@example.com')).toBeLessThan(text.indexOf('Sign out'));
  });

  it('without an operator, no identity is shown', () => {
    show();
    expect(screen.queryByText(/@example\.com/)).toBeNull();
  });
});
