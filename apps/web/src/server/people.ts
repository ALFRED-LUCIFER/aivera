import { createAudit } from '@credalent/audit/composition';
import type { CandidatesContract } from '@credalent/candidates';
import { createCandidates } from '@credalent/candidates/composition';
import { createEvidenceRecords } from '@credalent/evidence/composition';
import { applicationRecords } from '@credalent/intake/composition';
import { getDb } from './db';
import { getWorkspaces } from './workspace';

let candidates: CandidatesContract | undefined;
/**
 * The app's one candidates module instance, with duplicate merge wired (AIV-P1-018): applications and evidence move by
 * intake's and evidence's own calls. Every call takes the request context from `inActiveWorkspace`.
 */
export const getCandidates = (): CandidatesContract =>
  (candidates ??= createCandidates(getWorkspaces(), undefined, {
    audit: createAudit(getDb()),
    applications: applicationRecords,
    evidence: createEvidenceRecords(),
  }));
