'use client';

import { AddApplicantsDialog, useAddApplicantsController } from '@/features/add-applicants';
import { ChangeHiringOwner } from '@/features/job-header/components/ChangeHiringOwner.tsx';
import { AddCvsButton, JobHeader } from '@/features/job-header/components/JobHeader.tsx';
import { addCvsIsNext, type JobHeaderView } from '@/features/job-header/domain/jobHeader.ts';
import { useChangeOwnerController } from '@/features/job-header/hooks/useChangeOwnerController.ts';
import { useCurrentJobPage } from '@/features/job-header/hooks/useCurrentJobPage.ts';

export function JobHeaderNav({ view, canImport }: { view: JobHeaderView; canImport: boolean }) {
  const ownerChange = view.ownerChange ?? { currentUserId: null, options: [] };
  const owner = useChangeOwnerController(view.jobId, ownerChange);
  const addCvs = useAddApplicantsController(view.jobId);
  const current = useCurrentJobPage();
  return (
    <JobHeader
      view={view}
      current={current}
      addCvs={
        canImport && (
          <AddApplicantsDialog
            {...addCvs}
            jobTitle={view.title}
            trigger={<AddCvsButton primary={addCvsIsNext(view.rubric, current)} />}
          />
        )
      }
      ownerAction={
        view.ownerChange && (
          <ChangeHiringOwner
            view={owner}
            options={view.ownerChange.options}
            hasOwner={view.hiringOwner !== null}
            jobTitle={view.title}
          />
        )
      }
    />
  );
}
