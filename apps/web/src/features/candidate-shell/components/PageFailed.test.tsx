// @vitest-environment jsdom
import { intlConfig } from '@aivera/i18n';
import { IntlProvider } from '@aivera/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PageFailed } from './PageFailed.tsx';

afterEach(cleanup);

it('says the page could not load and "Try again" retries', async () => {
  const onRetry = vi.fn();
  render(
    <IntlProvider {...await intlConfig('en', 'Asia/Dubai')}>
      <PageFailed onRetry={onRetry} />
    </IntlProvider>,
  );
  expect(screen.getByRole('alert').textContent).toBe('This page could not load. Try again.');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
