import type { JobHeader, RubricState } from '@credalent/jobs';

// "Bring in candidates" (AIV-P1-101): the job picker and the footer, as plain data for the browser.

/** A job the member may import into: only what the picker shows. */
export type PickerJob = { id: string; title: string; rubric: RubricState };

/** A picker option's label as an `import.option` key and its values. */
export type PickerOption = {
  id: string;
  label:
    | { key: 'approvedVersion'; values: { title: string; version: number } }
    | { key: 'approved' | 'waiting'; values: { title: string } };
};

export type ImportView = {
  /** The job being imported into: the picker's value. */
  jobId: string;
  options: PickerOption[];
  /** Applications from the published job listing so far; null while the job is not published. */
  fromListing: number | null;
};

/**
 * The open job names its approved version, as the job header has it; the others say only whether a version is approved
 * (the Import artboard). Any rubric not approved is waiting: people are added now and assessed once it is.
 */
export function importView(jobs: PickerJob[], { job, approved }: JobHeader, careersPage: number): ImportView {
  return {
    jobId: job.id,
    options: jobs.map(({ id, title, rubric }) => ({
      id,
      label:
        id === job.id && approved
          ? { key: 'approvedVersion', values: { title, version: approved.version } }
          : { key: rubric.approved ? 'approved' : 'waiting', values: { title } },
    })),
    fromListing: job.published ? careersPage : null,
  };
}
