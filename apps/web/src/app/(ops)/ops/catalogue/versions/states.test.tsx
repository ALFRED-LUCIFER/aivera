// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import CatalogueVersionNotFound from './[n]/not-found.tsx';
import CatalogueVersionsError from './error.tsx';
import CatalogueVersionsLoading from './loading.tsx';

// AIV-P2-050 Scenario Outline "States": the read fails, version 99 is missing, and the page is loading.
afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});
const show = (node: ReactNode) => render(<IntlProvider {...intl}>{node}</IntlProvider>);

describe('Scenario Outline: States', () => {
  it('the read fails: "We could not load catalogue versions. Try again."', async () => {
    const retry = vi.fn();
    show(<CatalogueVersionsError error={new Error('x')} retry={retry} />);
    expect(screen.getByRole('alert').textContent).toBe('We could not load catalogue versions. Try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('version 99 is missing: "This catalogue version does not exist."', async () => {
    show(await CatalogueVersionNotFound());
    expect(screen.getByText('This catalogue version does not exist.')).toBeTruthy();
  });

  it('the page is loading: "Loading catalogue versions…"', async () => {
    show(await CatalogueVersionsLoading());
    expect(screen.getByRole('status').textContent).toBe('Loading catalogue versions…');
  });
});
