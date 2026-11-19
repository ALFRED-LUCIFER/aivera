import { describe, expect, it } from 'vitest';
import { catalogueView } from './catalogue.ts';

// AIV-P5-015: the view model built from the code catalogue (counts per pack and job type).
describe('catalogueView', () => {
  const view = catalogueView();

  it('lists the ten job types and the eight packs with their versions, Payments and fintech first', () => {
    expect(view.jobTypes).toMatchObject({ version: 1 });
    expect(view.jobTypes.entries).toHaveLength(10);
    expect(view.domainPacks.version).toBe(1);
    expect(view.domainPacks.packs).toHaveLength(8);
    expect(view.domainPacks.packs[0]?.labelKey).toBe('domainPacks.payments_fintech.label');
  });

  it('counts each job type’s competencies in a pack and leaves out job types it does not cover', () => {
    for (const pack of view.domainPacks.packs) {
      expect(pack.jobTypes.length).toBeGreaterThan(0);
      for (const entry of pack.jobTypes) {
        expect(entry.count).toBe(entry.core.length + entry.more.length);
        expect(entry.count).toBeGreaterThan(0);
        expect(entry.core.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('splits Payments and fintech for Software engineering into defaults, the rest and hints for each region', () => {
    const swe = view.domainPacks.packs[0]?.jobTypes.find((e) => e.jobType === 'software_engineering');
    expect(swe?.labelKey).toBe('jobTypes.software_engineering.label');
    expect(swe?.core.map((c) => c.name)).toContain('Idempotent payment APIs and retries');
    expect(swe?.core.every((c) => c.core.includes('software_engineering'))).toBe(true);
    expect(swe?.more.some((c) => c.core.includes('software_engineering'))).toBe(false);
    for (const region of ['uae', 'ksa', 'india'] as const) {
      expect(swe?.hints[region].length).toBeGreaterThan(0);
      expect(swe?.hints[region].every((h) => h.appliesTo.includes('software_engineering'))).toBe(true);
    }
  });
});
