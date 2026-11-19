'use client';

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
> & { defaultJobType: string };

export function NewJob({ defaultJobType, ...props }: Props) {
  const job = useNewJobController(defaultJobType);
  const { result, onDraft, onSaving, onUseStarters, rubric, ...draft } = useCompetencyDraftController();
  const send = useSendRubricController(job.state.rubricVersionId);
  if (job.state.saved) return <JobSaved {...send} />;
  return (
    <NewJobForm
      {...props}
      {...job}
      errors={result.status === 'invalid' ? result.errors : job.state.errors}
      onDraft={onDraft}
      onSaving={onSaving}
      rubric={rubric}
      drafting={draft.drafting}
      drafted={draft.rows.length > 0}
      draftSection={
        <CompetencyDraft
          {...draft}
          result={result}
          title={job.title}
          evidence={props.jobTypes.find((t) => t.value === job.jobType)?.evidence ?? null}
          onUseStarters={() => onUseStarters(job.jobType)}
        />
      }
    />
  );
}
