// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JobSaved } from './JobSaved.tsx';

afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const show = (canSend: boolean) =>
  render(
    <IntlProvider {...intl}>
      <JobSaved status="idle" pending={false} onSend={vi.fn()} jobId="j1" canSend={canSend} />
    </IntlProvider>,
  );

describe('Feature: Job saved (AIV-P1-165)', () => {
  it('Scenario: The saved page leads to the rubric', () => {
    show(false);
    const review = screen.getByRole('link', { name: 'Review and approve the rubric' });
    expect(review.getAttribute('href')).toBe('/app/jobs/j1/rubric');
  });

  it('Scenario: Nothing on the saved page sends an email in the pilot', () => {
    show(false);
    expect(screen.queryByRole('button', { name: 'Send rubric for approval' })).toBeNull();
  });

  it('where sending is on, "Send rubric for approval" is a secondary choice', () => {
    show(true);
    expect(screen.getByRole('button', { name: 'Send rubric for approval' })).toBeTruthy();
  });
});
