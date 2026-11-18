/** @vitest-environment jsdom */
import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { howSteps } from '../domain/sections.ts';
import { HowItWorks } from './HowItWorks.tsx';

vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

describe('Feature: How it works', () => {
  it('Scenario Outline: The five steps, rendered from the i18n keys in order', async () => {
    const t = await getTranslations(defaultLocale, defaultTimeZone);
    render(
      <HowItWorks
        contrast={[t('home.contrast.claims'), t('home.contrast.tests'), 'work']}
        title={t('home.how.title')}
        steps={howSteps.map((k) => ({ title: t(`home.how.steps.${k}.title`), body: t(`home.how.steps.${k}.body`) }))}
      />,
    );
    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps.map((li) => within(li).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Agree what matters',
      'Collect the work',
      'See why each person ranks where they do',
      'Interview only what is unproven',
      'Decide with the pack in front of you',
    ]);
    // Scenario: Safety principles are in the steps
    expect(steps[0]?.textContent).toContain('Nothing is assessed until the hiring manager approves.');
    expect(steps[2]?.textContent).toContain(
      'Claims are marked as claims, and count for nothing until something supports them.',
    );
    expect(steps[4]?.textContent).toContain('Aivera recommends. You decide.');
    expect(screen.getByText('A CV tells you what someone claims.')).toBeTruthy();
  });
});
