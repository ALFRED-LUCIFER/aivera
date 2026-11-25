/** A decision pack page as the server hands it to the browser (AIV-P2-010): plain data, scores as snapshotted. */
export type PackPage = {
  jobId: string;
  name: string;
  job: string;
  preparedAt: Date;
  /** The approved rubric version the pack is on, or null once the job's approved version has moved on. */
  rubricVersion: number | null;
  members: {
    candidateId: string;
    name: string | null;
    backedScore: number;
    upperBound: number;
    /** Who added the member and when; null on members added before this was stored, or once that account is gone. */
    added: { by: string; at: Date } | null;
  }[];
  /** The job's other applicants: they stay in the ranking and can be added to a later pack. */
  others: number;
};

/** The pack page's states: loading.tsx and error.tsx render the first two. */
export type DecisionPackView =
  { status: 'loading' } | { status: 'error'; onRetry: () => void } | { status: 'ready'; pack: PackPage };

/** One undecided pack on the job's Decision tab. */
export type PackLink = { id: string; name: string; members: number };
