// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceError from './error.tsx';

afterEach(cleanup);

describe('the workspace detail error state (AIV-P2-036)', () => {
  it('says the workspace could not load, without the error text, and retries', async () => {
    const retry = vi.fn();
    render(
      <IntlProvider {...await intlConfig('en', 'Asia/Dubai')}>
        <WorkspaceError error={new Error('select from workspaces failed')} retry={retry} />
      </IntlProvider>,
    );
    expect(screen.getByRole('alert').textContent).toBe('We could not load this workspace. Try again.');
    expect(screen.queryByText(/select from/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
