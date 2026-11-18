/** @vitest-environment jsdom */
import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { JOB_TYPE_CATALOGUE } from '@aivera/jobs';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  it('Scenario: The table matches the product catalogue: ten job types, in its order', async () => {
    const t = await getTranslations(defaultLocale, defaultTimeZone);
    render(
      <RoleFamilies
        title="Not only software engineers"
        lead=""
        noPublicWork=""
        familyHeader="Role family"
        evidenceHeader="Evidence that counts"
        rows={JOB_TYPE_CATALOGUE.map((j) => ({ key: j.key, family: t(j.labelKey), evidence: t(j.evidenceKey) }))}
        more=""
      />,
    );
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(
      JOB_TYPE_CATALOGUE.map((j) => t(j.labelKey)),
    );
    const sales = rows.find((r) => within(r).getByRole('rowheader').textContent === 'Sales');
    expect(sales && within(sales).getByRole('cell').textContent).toBe(
      'Closed deals, client references, pipeline records, market write-ups',
    );
  });
});
