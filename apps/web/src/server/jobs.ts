import { createAudit } from '@aivera/audit/composition';
import type { CatalogueReads, CompetencyDrafting, DomainDetecting, JobsContract } from '@aivera/jobs';
import {
  createCatalogueReads,
  createCompetencyDrafting,
  createDomainDetection,
  createJobs,
} from '@aivera/jobs/composition';
import { getAi } from './ai';
import { getDb } from './db';
import { getWorkspaces } from './workspace';

let jobs: JobsContract | undefined;
/** The app's one jobs module instance; every call takes the request context from `inActiveWorkspace`. */
export const getJobs = (): JobsContract => (jobs ??= createJobs(getWorkspaces(), createAudit(getDb())));

let drafting: CompetencyDrafting | undefined;
/** "Draft competencies" (AIV-P1-008) on the app's AI client. */
export const getCompetencyDrafting = (): CompetencyDrafting => (drafting ??= createCompetencyDrafting(getAi()));

let detection: DomainDetecting | undefined;
/** "Detect the job's industry" (AIV-P1-063) on the app's AI client. */
export const getDomainDetection = (): DomainDetecting => (detection ??= createDomainDetection(getAi()));

let catalogue: CatalogueReads | undefined;
/** The catalogue (ADR-013): everything outside /ops reads only its latest published version. */
export const getCatalogue = (): CatalogueReads => (catalogue ??= createCatalogueReads(getDb()));
