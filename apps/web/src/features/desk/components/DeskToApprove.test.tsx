// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DeskToApprove } from './DeskToApprove.tsx';

// AIV-P1-084 (ADR-014): My desk's "Rubrics to approve". Synthetic job titles.

afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});
const show = (items: Parameters<typeof DeskToApprove>[0]['items']) =>
  render(
    <IntlProvider {...intl}>
      <DeskToApprove items={items} />
    </IntlProvider>,
  );

describe('Rubrics to approve', () => {
  it('lists each job and version, each opening its rubric page by an opaque job id', () => {
    show([
      { jobId: 'j1', job: 'Senior Backend Engineer', version: 1, returned: false },
      { jobId: 'j2', job: 'Platform Engineer', version: 2, returned: true },
    ]);
    expect(screen.getByRole('heading', { name: 'Rubrics to approve' })).toBeTruthy();
    expect(screen.getByText('Senior Backend Engineer, version 1.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the Senior Backend Engineer rubric' }).getAttribute('href')).toBe(
      '/app/jobs/j1/rubric',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('a returned version says so in words, not colour alone', () => {
    show([{ jobId: 'j2', job: 'Platform Engineer', version: 2, returned: true }]);
    expect(screen.getByText('Returned with a note')).toBeTruthy();
  });

  it('nothing waiting says so', () => {
    show([]);
    expect(screen.getByText('No rubrics are waiting for you')).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});
