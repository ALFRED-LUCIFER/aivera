import type { RubricApproval } from '@aivera/jobs';

/** A rubric approval on My desk (AIV-P1-014): waiting with the hiring owner, or done once approved. */
export type ApprovalItem = {
  jobId: string;
  job: string;
  version: number;
  /** The owner's title in the workspace ("Head of Engineering"), else their name; null when the job has none. */
  owner: string | null;
  done: boolean;
};

/** Waiting items first, each group in the jobs' order. `owners` resolves hiring owner ids to what the desk calls them. */
export const approvalItems = (rows: RubricApproval[], owners: ReadonlyMap<string, string>): ApprovalItem[] =>
  rows
    .map((r) => ({
      jobId: r.jobId,
      job: r.title,
      version: r.version,
      owner: (r.hiringOwnerUserId && owners.get(r.hiringOwnerUserId)) || null,
      done: r.status === 'approved',
    }))
    .toSorted((a, b) => Number(a.done) - Number(b.done));
