import type { JobHeader, RubricState } from '@credalent/jobs';

// "Bring in candidates" (AIV-P1-101): the job picker, as plain data for the browser.

/** A job the member may import into: only what the picker shows. */
export type PickerJob = { id: string; title: string; rubric: RubricState };

/** A picker option's label as an `import.option` key and its values. */
export type PickerOption = {
  id: string;
  label:
    | { key: 'approvedVersion'; values: { title: string; version: number } }
    | { key: 'approved' | 'waiting' | 'draft' | 'returned' | 'none'; values: { title: string } };
};

export type ImportView = {
  /** The job being imported into: the picker's value. */
  jobId: string;
  /** Named in the add dialog's confirmation line (AIV-P1-104). */
  jobTitle: string;
  options: PickerOption[];
};

/** What a job's rubric is doing, in the picker's words: only a version sent for approval is "waiting". */
const rubricKey = ({ approved, latest }: RubricState) =>
  approved
    ? 'approved'
    : latest === 'awaiting_approval'
      ? 'waiting'
      : latest === 'draft' || latest === 'returned'
        ? latest
        : 'none';

/**
 * The open job names its approved version, as the job header has it; the others say only where their rubric stands (the
 * Import artboard). People are added to any job now and assessed once its rubric is approved.
 */
export function importView(jobs: PickerJob[], { job, approved }: JobHeader): ImportView {
  return {
    jobId: job.id,
    jobTitle: job.title,
    options: jobs.map(({ id, title, rubric }) => ({
      id,
      label:
        id === job.id && approved
          ? { key: 'approvedVersion', values: { title, version: approved.version } }
          : { key: rubricKey(rubric), values: { title } },
    })),
  };
}
