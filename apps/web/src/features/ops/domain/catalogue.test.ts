import { describe, expect, it } from 'vitest';
import { packForJobType } from '@credalent/jobs';
import { CATALOGUE_V1 } from '@/test/catalogue-v1.ts';
import { catalogueView } from './catalogue.ts';

// AIV-P5-015, AIV-P2-044: the view model built from the published catalogue (counts per pack and job type).
describe('catalogueView', () => {
  const view = catalogueView(CATALOGUE_V1);

  it('lists the ten job types and the eight packs with their versions, Payments and fintech first', () => {
    expect(view.jobTypes).toMatchObject({ version: 1 });
    expect(view.jobTypes.entries).toHaveLength(10);
    expect(view.jobTypes.entries[0]).toMatchObject({
      label: 'Software engineering',
      evidence: 'Repositories, shipped products, code reviews',
    });
    expect(view.domainPacks.version).toBe(1);
    expect(view.domainPacks.packs).toHaveLength(8);
    expect(view.domainPacks.packs[0]?.label).toBe('Payments and fintech');
  });

  it('counts each job type’s competencies in a pack and leaves out job types it does not cover', () => {
    for (const pack of view.domainPacks.packs) {
      expect(pack.jobTypes.length).toBeGreaterThan(0);
      for (const entry of pack.jobTypes) {
        expect(entry.count).toBe(entry.core.length + entry.more.length);
        expect(entry.core.length).toBeLessThanOrEqual(4);
      }
      // A job type left out has nothing in the pack: no competency and no regional hint is hidden.
      for (const { key } of CATALOGUE_V1.jobTypes.filter((j) => !pack.jobTypes.some((e) => e.jobType === j.key))) {
        const left = packForJobType(CATALOGUE_V1, pack.key, key);
        expect([...(left?.core ?? []), ...(left?.more ?? []), ...(left?.hints ?? [])]).toEqual([]);
      }
    }
  });

  it('splits Payments and fintech for Software engineering into defaults, the rest and hints for each region', () => {
    const swe = view.domainPacks.packs[0]?.jobTypes.find((e) => e.jobType === 'software_engineering');
    expect(swe?.label).toBe('Software engineering');
    expect(swe?.core.map((c) => c.name)).toContain('Idempotent payment APIs and retries');
    expect(swe?.core.every((c) => c.core.includes('software_engineering'))).toBe(true);
    expect(swe?.more.some((c) => c.core.includes('software_engineering'))).toBe(false);
    expect(swe?.hints.map((h) => [h.region, h.label])).toEqual([
      ['uae', 'UAE'],
      ['ksa', 'KSA'],
      ['india', 'India'],
    ]);
    for (const { entries } of swe?.hints ?? []) {
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((h) => h.appliesTo.includes('software_engineering'))).toBe(true);
    }
  });
});
