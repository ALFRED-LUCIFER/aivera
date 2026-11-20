// The read-only catalogue view (AIV-P5-015): the published catalogue's job types and domain packs. Pure (ADR-003).
import { packForJobType, type CatalogueVersion } from '@aivera/jobs';

/** Where the catalogue changes until the editor ships (AIV-P2-045): a reviewed migration. */
export const CATALOGUE_SOURCE =
  'https://github.com/ALFRED-LUCIFER/aivera/tree/main/modules/jobs/src/infrastructure/migrations';

/**
 * Every job type, and every pack split by the job types it covers (a job type with no competency and no hint is left
 * out), each pack's hints grouped by region in catalogue order.
 */
export function catalogueView(catalogue: CatalogueVersion) {
  const regions = catalogue.regions.filter((r) => !r.retired);
  return {
    jobTypes: {
      version: catalogue.version,
      entries: catalogue.jobTypes.map((t) => ({
        key: t.key,
        label: t.label.en,
        evidence: t.evidence.en,
        starterCompetencies: t.starterCompetencies,
      })),
    },
    domainPacks: {
      version: catalogue.version,
      packs: catalogue.packs.map((pack) => ({
        key: pack.key,
        label: pack.label.en,
        jobTypes: catalogue.jobTypes.flatMap((jobType) => {
          const forJobType = packForJobType(catalogue, pack.key, jobType.key);
          if (!forJobType) return [];
          const { core, more, hints } = forJobType;
          const count = core.length + more.length;
          if (!count && !hints.length) return [];
          return [
            {
              jobType: jobType.key,
              label: jobType.label.en,
              count,
              core,
              more,
              hints: regions.map((r) => ({
                region: r.key,
                label: r.label.en,
                entries: hints.filter((h) => h.region === r.key),
              })),
            },
          ];
        }),
      })),
    },
  };
}

export type CatalogueView = ReturnType<typeof catalogueView>;
