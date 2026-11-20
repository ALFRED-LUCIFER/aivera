// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewJobError from './error.tsx';

afterEach(cleanup);

// AIV-P2-044 Scenario: The catalogue read fails.
describe('Add a job when the catalogue cannot be read', () => {
  it('says job types could not load, shows no job type list and no error text, and retries', async () => {
    const retry = vi.fn();
    render(
      <IntlProvider {...await intlConfig('en', 'Asia/Dubai')}>
        <NewJobError error={new Error('select from jobs.catalogue_version failed')} retry={retry} />
      </IntlProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Add a job' })).toBeDefined();
    expect(screen.getByRole('alert').textContent).toContain('We could not load job types. Try again.');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/Software engineering|catalogue_version/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
