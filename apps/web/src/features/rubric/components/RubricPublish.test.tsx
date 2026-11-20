// @vitest-environment jsdom
import { intlConfig } from '@credalent/i18n';
import { IntlProvider } from '@credalent/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PublicationView, PublishView } from '../domain/rubric.ts';
import { RubricPublish } from './RubricPublish.tsx';

afterEach(cleanup);

let intl: Awaited<ReturnType<typeof intlConfig>>;
beforeAll(async () => {
  intl = await intlConfig('en', 'Asia/Dubai');
});

const publication = (more: Partial<PublicationView> = {}): PublicationView => ({
  published: false,
  approved: true,
  slug: null,
  descriptor: null,
  competencies: 6,
  ...more,
});
const controller = (more: Partial<PublishView> = {}): PublishView => ({
  previewing: false,
  descriptor: '',
  pending: false,
  status: 'idle',
  onPreview: vi.fn(),
  onCancel: vi.fn(),
  onDescriptor: vi.fn(),
  onPublish: vi.fn(async () => undefined),
  onUnpublish: vi.fn(),
  returnFocus: false,
  ...more,
});
const show = (p: PublicationView, c: PublishView) =>
  render(
    <IntlProvider {...intl}>
      <RubricPublish publication={p} publish={c} />
    </IntlProvider>,
  );

describe('Feature: Publish a job on the candidate site (AIV-P1-015)', () => {
  it('not published: says who can apply, and "Publish this job" opens the preview', async () => {
    const c = controller();
    show(publication(), c);
    expect(screen.getByText(/^Not published\. Only candidates you add can apply\./)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Publish this job' }));
    expect(c.onPreview).toHaveBeenCalledOnce();
  });

  it('Scenario: Preview before publishing: what is shown and what is hidden', () => {
    show(publication(), controller({ previewing: true, descriptor: 'A BNPL fintech' }));
    expect(screen.getByRole('heading', { name: 'Preview: what candidates will see' })).toBeTruthy();
    expect(
      screen.getByText('Shown: title, location, pay band, the six competencies and the level each needs.'),
    ).toBeTruthy();
    expect(screen.getByText("Hidden: weights, the client's name, other candidates and all scores.")).toBeTruthy();
    expect(screen.getByText('Applications arrive in your Inbox.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(false);
  });

  it('Publish needs how candidates see the employer', () => {
    show(publication(), controller({ previewing: true, descriptor: '  ' }));
    expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(true);
  });

  it('Scenario: A job without an approved rubric cannot be published', () => {
    show(publication({ approved: false }), controller());
    const button = screen.getByRole('button', { name: 'Publish this job' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Publish after the rubric is approved.')).toBeTruthy();
  });

  it('published: live, with "View public listing" and "Unpublish"', async () => {
    const c = controller();
    show(publication({ published: true, slug: 'senior-ai-engineer-a1b2' }), c);
    expect(screen.getByText('Live on the candidate site. New applications arrive in your Inbox.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View public listing' }).getAttribute('href')).toBe(
      '/candidates/jobs/senior-ai-engineer-a1b2',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    expect(c.onUnpublish).toHaveBeenCalledOnce();
  });
});
