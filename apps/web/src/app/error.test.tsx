// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RootErrorPage from './error.tsx';

afterEach(cleanup);

describe('Scenario: A crash shows a safe error page', () => {
  it('says something went wrong, offers Try again, and shows none of the error text', async () => {
    const retry = vi.fn();
    render(
      <IntlProvider {...await intlConfig('en', 'Asia/Dubai')}>
        <RootErrorPage error={new Error('select * from candidates failed for sara@example.com')} retry={retry} />
      </IntlProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong. Try again.' })).toBeDefined();
    expect(document.body.textContent).not.toMatch(/select|candidates|example\.com/);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
