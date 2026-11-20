import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { DOMAIN_KEYS, JOB_TYPE_CATALOGUE, JOB_TYPES, REGIONS } from '@aivera/jobs';
import { describe, expect, it } from 'vitest';
import { morePackCompetencies, packCompetencies, starterCompetencies } from './draft.ts';
import { descriptionPlaceholder } from './jobNew.ts';

// AIV-P2-044: what Add a job and the marketing page show, recorded from the code catalogue before it was deleted. The
// same view model built from catalogue version 1 must equal this snapshot, so reading the database changes nothing.

describe('Add a job and the marketing page, from catalogue version 1', () => {
  it('equals the view model built from the code catalogue', async () => {
    const t = await getTranslations(defaultLocale, defaultTimeZone);
    expect({
      jobTypes: JOB_TYPE_CATALOGUE.map((e) => ({ value: e.key, label: t(e.labelKey), evidence: t(e.evidenceKey) })),
      placeholders: JOB_TYPES.map((jobType) => descriptionPlaceholder('What this person must be able to do:', jobType)),
      starters: JOB_TYPES.map((jobType) => starterCompetencies(jobType)),
      packs: DOMAIN_KEYS.map((key) => ({
        key,
        label: t(`domainPacks.${key}.label`),
        byJobType: JOB_TYPES.map((jobType) => ({
          suggested: packCompetencies(key, jobType, REGIONS),
          more: morePackCompetencies(key, jobType, []),
        })),
      })),
    }).toMatchSnapshot();
  });
});
