/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvidenceCard } from './EvidenceCard.tsx';

const labels = {
  name: 'Hessa Al Mazrouei',
  role: 'QA Automation Engineer · rank 1 of 38',
  scoreName: 'Backed score 72, up to 85 if her open claim holds',
  backed: '72 backed by evidence',
  caption: '72 backed by evidence · up to 85 if her open claim holds',
  upTo: 'up to 85 if her open claim holds',
  unavailable: 'Score unavailable',
  competency: 'Test automation design',
  weight: '· weight 25%',
  strength: 'Strong',
  provenance: 'Independently corroborated',
  markLabel: 'cited evidence',
  sources: 'Sources',
  sourceRepo: 'hessa.aivera.example/checkout-e2e',
  sourceCi: 'CI history, checked 12 Nov',
  synthetic: 'Illustrative candidate, synthetic data.',
};
const evidence = 'In the repository checkout-e2e she wrote 148 of 171 test cases.';

afterEach(() => vi.unstubAllGlobals());

describe('Scenario: Reduced motion shows the final state', () => {
  // SAFETY: mutation check: removed the reducedMotion guard in playsIntro -> this test failed (score 0, stage ready)
  it('shows 72 at once, with the fixed accessible name and the cited words highlighted', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    // An observer that never fires: had the intro started, the score would sit at 0 in stage "ready".
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const { container } = render(
      <EvidenceCard
        backed={72}
        upTo={85}
        evidence={evidence}
        citations={[{ start: 35, end: 62, sourceId: 'checkout-e2e' }]}
        labels={labels}
      />,
    );
    const score = screen.getByRole('img', { name: labels.scoreName });
    expect(score.textContent).toMatch(/^72/);
    expect(container.querySelector('[data-stage]')?.getAttribute('data-stage')).toBe('final');
    expect(container.querySelector('mark')?.textContent).toContain('wrote 148 of 171 test cases');
    expect(screen.getByText(labels.synthetic)).toBeTruthy();
  });
});
