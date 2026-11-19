// The read-only catalogue view (AIV-P5-015): the job types and domain packs from the jobs contracts. Pure (ADR-003).
import {
  DOMAIN_PACK_CATALOGUE_VERSION,
  JOB_TYPE_CATALOGUE,
  JOB_TYPE_CATALOGUE_VERSION,
  JOB_TYPES,
  getDomainPack,
  listDomainPacks,
} from '@aivera/jobs';

/** Where the catalogue is edited: only through a reviewed pull request. */
export const CATALOGUE_SOURCES = {
  jobTypes: 'https://github.com/ALFRED-LUCIFER/aivera/blob/main/modules/jobs/src/domain/job-types.ts',
  domainPacks: 'https://github.com/ALFRED-LUCIFER/aivera/blob/main/modules/jobs/src/domain/domain-packs.ts',
} as const;

/** Every job type, and every pack split by the job types it covers (a job type with no competency and no hint is left out). */
export function catalogueView() {
  return {
    jobTypes: { version: JOB_TYPE_CATALOGUE_VERSION, entries: JOB_TYPE_CATALOGUE },
    domainPacks: {
      version: DOMAIN_PACK_CATALOGUE_VERSION,
      packs: listDomainPacks().map((pack) => ({
        key: pack.key,
        labelKey: pack.labelKey,
        jobTypes: JOB_TYPES.flatMap((jobType) => {
          const forJobType = getDomainPack(pack.key, jobType);
          if (!forJobType) return [];
          const { core, more, hints } = forJobType;
          const count = core.length + more.length;
          if (!count && !Object.values(hints).some((list) => list.length)) return [];
          return [{ jobType, labelKey: `jobTypes.${jobType}.label` as const, count, core, more, hints }];
        }),
      })),
    },
  };
}

export type CatalogueView = ReturnType<typeof catalogueView>;
