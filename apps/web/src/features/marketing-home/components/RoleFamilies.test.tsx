/** @vitest-environment jsdom */
import { offeredJobTypes } from '@credalent/jobs';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CATALOGUE_V1 } from '@/test/catalogue-v1.ts';
import { RoleFamilies } from './RoleFamilies.tsx';

vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

describe('Feature: Role families', () => {
  it('Scenario: The table matches the product catalogue: ten job types, in its order', () => {
    render(
      <RoleFamilies
        title="Not only software engineers"
        lead=""
        noPublicWork=""
        familyHeader="Role family"
        evidenceHeader="Evidence that counts"
        rows={offeredJobTypes(CATALOGUE_V1).map((j) => ({ key: j.key, family: j.label.en, evidence: j.evidence.en }))}
        more=""
      />,
    );
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(
      CATALOGUE_V1.jobTypes.map((j) => j.label.en),
    );
    const sales = rows.find((r) => within(r).getByRole('rowheader').textContent === 'Sales');
    expect(sales && within(sales).getByRole('cell').textContent).toBe(
      'Closed deals, client references, pipeline records, market write-ups',
    );
  });
});
