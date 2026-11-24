import { createAudit } from '@credalent/audit/composition';
import type { EvidenceContract } from '@credalent/evidence';
import { createEvidence } from '@credalent/evidence/composition';
import { createCandidateJobResolver } from '@credalent/intake/composition';
import { getDb } from './db';
import { getJobs } from './jobs';
import { getWorkspaces } from './workspace';

let evidence: EvidenceContract | undefined;
/** The app's one evidence module instance (AIV-P1-033 reads a candidate's evidence to cite); every call takes the request context. */
export const getEvidence = (): EvidenceContract =>
  (evidence ??= createEvidence(
    getWorkspaces(),
    createAudit(getDb()),
    undefined,
    createCandidateJobResolver(getJobs()),
  ));
