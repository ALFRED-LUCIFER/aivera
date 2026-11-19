// @vitest-environment jsdom
import { intlConfig } from '@aivera/i18n';
import { IntlProvider } from '@aivera/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type WorkspaceSettings } from '@/features/settings/domain/settings.ts';
import { useSettingsController } from '@/features/settings/hooks/useSettingsController.ts';
import { SettingsForm } from '@/features/settings/components/SettingsForm.tsx';

// AIV-P1-052: the settings form with its controller; the server action is replaced by `save`.
vi.mock('@/features/settings/services/saveSettings.ts', () => ({ saveSettings: vi.fn() }));
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const SAVED = 'Settings saved. New links, invitations and sessions use them; existing ones keep their expiry.';

function Settings(props: {
  saved?: WorkspaceSettings;
  canEdit?: boolean;
  save?: (s: WorkspaceSettings) => Promise<WorkspaceSettings>;
}) {
  const view = useSettingsController(props.saved ?? DEFAULT_SETTINGS, props.save ?? (async (s) => s));
  return (
    <IntlProvider {...intl}>
      <SettingsForm view={view} canEdit={props.canEdit ?? true} />
    </IntlProvider>
  );
}

const shortlist = () => screen.getByLabelText('Client shortlist link lasts');

describe('SettingsForm', () => {
  it('Scenario: An admin sees every setting with its current value and range', () => {
    render(<Settings />);
    for (const group of [
      'Sharing and invitations',
      'Sign-in',
      'Candidates and evidence',
      'Interviews',
      'Value dashboard',
      'Candidate feedback',
    ])
      expect(screen.getByRole('group', { name: group })).toBeTruthy();
    expect(shortlist()).toHaveProperty('value', '14');
    expect(shortlist().getAttribute('aria-describedby')).toContain('setting-clientShareLinkDays-hint');
    expect(document.getElementById('setting-clientShareLinkDays-hint')?.textContent).toBe('1 to 30 days');
    expect(screen.queryByText(/^Default:/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Save settings' })).toHaveLength(1);
  });

  it('Scenario: Saving a change', async () => {
    const save = vi.fn(async (s: WorkspaceSettings) => s);
    render(<Settings save={save} />);
    await userEvent.clear(shortlist());
    await userEvent.type(shortlist(), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, clientShareLinkDays: 7 });
    expect(await screen.findByText(SAVED)).toBeTruthy();
    expect(shortlist()).toHaveProperty('value', '7');
    expect(screen.getByText('Default: 14')).toBeTruthy();
  });

  // SAFETY: mutation check: parseForm accepted any number (no bounds check) -> this test failed (save was called)
  it('Scenario: A value out of range is explained, not saved', async () => {
    const save = vi.fn(async (s: WorkspaceSettings) => s);
    render(<Settings save={save} />);
    const idle = screen.getByLabelText('Sign out after inactivity');
    await userEvent.clear(idle);
    await userEvent.type(idle, '24');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    const error = screen.getByText('Enter a number from 1 to 12');
    expect(idle.getAttribute('aria-describedby')).toContain(error.id);
    expect(idle.getAttribute('aria-invalid')).toBe('true');
    expect(save).not.toHaveBeenCalled();
  });

  it('Scenario: Other roles can read but not change', () => {
    render(<Settings canEdit={false} saved={{ ...DEFAULT_SETTINGS, clientShareLinkDays: 7 }} />);
    expect(screen.getByText('Only an admin can change these settings')).toBeTruthy();
    expect(shortlist()).toHaveProperty('readOnly', true);
    expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Use default/ })).toBeNull();
  });

  it('Scenario: Restore a default', async () => {
    const save = vi.fn(async (s: WorkspaceSettings) => s);
    render(<Settings save={save} saved={{ ...DEFAULT_SETTINGS, clientShareLinkDays: 7 }} />);
    expect(screen.getByText('Default: 14')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Use default for Client shortlist link lasts' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(save).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    expect(shortlist()).toHaveProperty('value', '14');
    expect(screen.queryByText(/^Default:/)).toBeNull();
  });

  it('Scenario: Loading and error states', async () => {
    const { unmount } = render(
      <IntlProvider {...intl}>
        <SettingsForm view="loading" canEdit />
      </IntlProvider>,
    );
    expect(screen.getByRole('button', { name: 'Save settings' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Loading settings')).toBeTruthy();
    unmount();

    render(<Settings save={() => Promise.reject(new Error('down'))} />);
    await userEvent.clear(shortlist());
    await userEvent.type(shortlist(), '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Settings were not saved. Try again.');
    expect(shortlist()).toHaveProperty('value', '9');
  });
});
