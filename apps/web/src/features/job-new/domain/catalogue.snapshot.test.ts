import { describe, expect, it } from 'vitest';
import { CATALOGUE_V1 } from '@/test/catalogue-v1.ts';
import { catalogueChoices, morePackCompetencies, packCompetencies, starterCompetencies } from './draft.ts';
import { descriptionPlaceholder, jobTypeOptions } from './jobNew.ts';

// AIV-P2-044: what Add a job and the marketing page show, recorded from the code catalogue before it was deleted. The
// same view model built from catalogue version 1 must equal this snapshot, so reading the database changes nothing.

describe('Add a job and the marketing page, from catalogue version 1', () => {
  it('equals the view model built from the code catalogue', () => {
    const options = jobTypeOptions(CATALOGUE_V1);
    const jobTypes = options.map((o) => o.value);
    const { packs, regions } = catalogueChoices(CATALOGUE_V1);
    expect({
      jobTypes: options.map(({ value, label, evidence }) => ({ value, label, evidence })),
      placeholders: options.map((o) => descriptionPlaceholder('What this person must be able to do:', o.starters)),
      starters: jobTypes.map((jobType) => starterCompetencies(CATALOGUE_V1, jobType)),
      packs: packs.map(({ key, label }) => ({
        key,
        label,
        byJobType: jobTypes.map((jobType) => ({
          suggested: packCompetencies(
            CATALOGUE_V1,
            key,
            jobType,
            regions.map((r) => r.key),
          ),
          more: morePackCompetencies(CATALOGUE_V1, key, jobType, []),
        })),
      })),
    }).toMatchSnapshot();
  });
});
