import type { EvidenceItemView } from '@credalent/evidence';
import { JOB_SCOPED_ROLES, type WorkspaceContext } from '@credalent/workspaces';
import { z } from 'zod';
import { getAssessment } from '@/server/assessment';
import { getEvidence } from '@/server/evidence';
import { getFiles } from '@/server/files';
import { getIntake } from '@/server/intake';
import { getApprovedRubricReads, getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { evidenceCards, sourceNote, type SourceNoteView } from '../domain/evidenceCards.ts';
import { needRows } from '../domain/needs.ts';
import type { Fit, ProfileData } from '../domain/profile.ts';

const ids = z.object({ candidateId: z.uuid(), jobId: z.uuid() });

/** The evidence read that holds each kind of source's "Unusual content in this source" notes. */
const NOTE_READS = { cv: 'getCvParse', document: 'getDocumentRead', shipped_product: 'getLinkRead' } as const;

// shortcut: one read per CV, document and link source; add a notes-by-candidate read to evidence if a candidate ever
// carries dozens of them.
async function notesOf(ctx: WorkspaceContext, evidence: readonly EvidenceItemView[]): Promise<SourceNoteView[]> {
  const sources = new Map(evidence.map((item) => [item.source.id, item.source]));
  const notes: SourceNoteView[] = [];
  for (const source of sources.values()) {
    if (!(source.kind in NOTE_READS)) continue;
    const read = await getEvidence()[NOTE_READS[source.kind as keyof typeof NOTE_READS]](ctx, source.id);
    for (const note of read?.notes ?? []) notes.push(sourceNote(source, note, notes.length));
  }
  return notes;
}

/**
 * A candidate's evidence profile for one job (AIV-P1-043, AIV-P1-044, AIV-P1-045): who they are, where the application stands, the
 * fit, why they rank there, and what each competency's score rests on. 'forbidden' when a job-scoped member (hiring
 * owner, interviewer) is not granted the job; 'notFound' for a job or candidate the workspace does not have, a
 * candidate who did not apply to the job, or a malformed id: none says whether the record exists elsewhere. Null with
 * no workspace. Intake, assessment and evidence check `candidate.view` on the job themselves; a refusal there renders
 * the 403 page (`inActiveWorkspace`). A hiring owner or interviewer granted the job reads the cited excerpts and the
 * sources' names, never a link to an uploaded file nor the "Unusual content" quotes (AGENTS.md 1.9).
 */
// shortcut: the explanation loads with the page, so the first view of a new snapshot waits for the model (cached after,
// AIV-P1-033); stream it under Suspense if pilot recruiters wait on it.
export async function loadProfile(
  candidateId: string,
  jobId: string | undefined,
): Promise<ProfileData | 'notFound' | 'forbidden' | null> {
  const parsed = ids.safeParse({ candidateId, jobId });
  if (!parsed.success) return 'notFound';
  const job = parsed.data.jobId;
  const result = await inActiveWorkspace(async (ctx): Promise<ProfileData | 'notFound' | 'forbidden'> => {
    const found = await getJobs().getJob(ctx, job);
    // Row-level security hides an ungranted job, so a job-scoped member learns nothing about a job they cannot see.
    if (!found) return JOB_SCOPED_ROLES.includes(ctx.role) ? 'forbidden' : 'notFound';
    // shortcut: reads the job's whole applicant list to find one; add a single-application read to intake past ~500.
    const applicant = (await getIntake().listApplicationsForJob(ctx, job)).find((a) => a.personId === candidateId);
    // Not an applicant of this job (or another workspace's person): nothing about them is read.
    if (!applicant) return 'notFound';
    const base = { jobId: job, jobTitle: found.title, name: applicant.displayName, stage: applicant.stage };
    const none = { explanation: null, competencies: [], needs: [], notes: [] };
    const ranking = await getAssessment().listRanking(ctx, job);
    if (ranking.status === 'awaiting_rubric') return { ...base, fit: { status: 'awaiting_rubric' }, ...none };
    const row = ranking.rows.find((r) => r.candidateId === candidateId);
    if (!row) return { ...base, fit: { status: 'not_scored' }, ...none };
    const latest = await getAssessment().getLatestAssessment(ctx, candidateId, job);
    const explanation = await getAssessment().explainRanking(ctx, candidateId, job);
    // The ranking row is the latest result on the approved version; a result on another version names no claims and
    // cites no evidence here.
    const results = latest?.rubricVersionId === ranking.rubricVersionId ? latest.competencies : [];
    // Not authorised itself: `getJob` and `listRanking` above authorised this job for the member (as loadRanking does).
    const rubric = await getApprovedRubricReads().approvedRubric(ctx.tx, ctx.workspaceId, job);
    const names = new Map(
      rubric?.id === ranking.rubricVersionId ? rubric.competencies.map((c) => [c.id, c.name] as const) : [],
    );
    const evidence = await getEvidence().listEvidenceForCandidate(ctx, candidateId, job);
    // SAFETY: raw candidate files and the quotes of unusual content are for admins and recruiters (AGENTS.md 1.9); the
    // evidence and files modules refuse a job-scoped member too.
    const seesFiles = !JOB_SCOPED_ROLES.includes(ctx.role);
    const fit: Fit = {
      status: 'scored',
      rank: row.rank,
      backedScore: row.backedScore,
      upperBound: row.upperBound,
      meetsNeed: row.meetsNeed,
      competencyCount: row.competencyCount,
      ranked: ranking.rows.length,
      openClaims: results.filter((c) => c.claimedLevel > c.proven.level).length,
    };
    return {
      ...base,
      fit,
      explanation: explanation && { source: explanation.source, statements: explanation.statements },
      // With no storage account no file can be opened, so no file link is drawn.
      competencies: evidenceCards(results, names, evidence, seesFiles && getFiles() !== null),
      needs: needRows(results, names),
      notes: seesFiles ? await notesOf(ctx, evidence) : [],
    };
  });
  return result && result.value;
}
