'use client';

import type { CatalogueContent } from '@credalent/jobs';
import type { ComponentProps } from 'react';
import { CompetencyDraft } from '@/features/job-new/components/CompetencyDraft.tsx';
import { JobSaved } from '@/features/job-new/components/JobSaved.tsx';
import { NewJobForm } from '@/features/job-new/components/NewJobForm.tsx';
import { useCompetencyDraftController } from '@/features/job-new/hooks/useCompetencyDraftController.ts';
import { useNewJobController } from '@/features/job-new/hooks/useNewJobController.ts';
import { useSendRubricController } from '@/features/job-new/hooks/useSendRubricController.ts';

type Props = Pick<
  ComponentProps<typeof NewJobForm>,
  'labels' | 'jobTypes' | 'hiringOwners' | 'clients' | 'membersHref'
> & {
  defaultJobType: string;
  catalogue: CatalogueContent;
  canSend: boolean;
  earlierJobs: ComponentProps<typeof CompetencyDraft>['earlierJobs'];
};

export function NewJob({ defaultJobType, catalogue, canSend, earlierJobs, ...props }: Props) {
  const job = useNewJobController(defaultJobType, catalogue);
  const { result, onDraft, onSaving, onUseStarters, rubric, replacing, onConfirmRedraft, onCancelRedraft, ...draft } =
    useCompetencyDraftController(catalogue);
  const send = useSendRubricController(job.state.rubricVersionId);
  if (job.state.saved) return <JobSaved {...send} jobId={job.state.jobId} canSend={canSend} />;
  return (
    <NewJobForm
      {...props}
      // "Invite a hiring owner" leads to a Members invitation, which is an email: off where sending is (AIV-P1-165).
      membersHref={canSend ? props.membersHref : null}
      {...job}
      errors={result.status === 'invalid' ? result.errors : job.state.errors}
      // A new draft collapses the job fields again (AIV-P1-165).
      onDraft={(form) => {
        job.onDetailsOpenChange(false);
        onDraft(form);
      }}
      replacing={replacing}
      onConfirmRedraft={onConfirmRedraft}
      onCancelRedraft={onCancelRedraft}
      onSaving={onSaving}
      rubric={rubric}
      drafting={draft.drafting}
      drafted={draft.rows.length > 0}
      draftSection={
        <CompetencyDraft
          {...draft}
          result={result}
          earlierJobs={earlierJobs}
          title={job.title}
          evidence={props.jobTypes.find((t) => t.value === job.jobType)?.evidence ?? null}
          onUseStarters={() => onUseStarters(job.jobType)}
        />
      }
    />
  );
}
