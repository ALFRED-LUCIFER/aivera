// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import CatalogueError from './error.tsx';
import CatalogueLoading from './loading.tsx';

// AIV-P2-045 Scenario Outline "Page states": the catalogue read fails, and the page is loading.
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});
const show = (node: ReactNode) => render(<IntlProvider {...intl}>{node}</IntlProvider>);

describe('Scenario Outline: Page states', () => {
  it('the catalogue read fails: "We could not load the catalogue. Try again."', async () => {
    const retry = vi.fn();
    show(<CatalogueError error={new Error('x')} retry={retry} />);
    expect(screen.getByRole('alert').textContent).toBe('We could not load the catalogue. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('the page is loading: "Loading the catalogue…"', async () => {
    show(await CatalogueLoading());
    expect(screen.getByRole('status').textContent).toBe('Loading the catalogue…');
  });
});
