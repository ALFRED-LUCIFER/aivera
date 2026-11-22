'use client';

import { ChangeHiringOwner } from '@/features/job-header/components/ChangeHiringOwner.tsx';
import { JobHeader } from '@/features/job-header/components/JobHeader.tsx';
import type { JobHeaderView } from '@/features/job-header/domain/jobHeader.ts';
import { useChangeOwnerController } from '@/features/job-header/hooks/useChangeOwnerController.ts';
import { useCurrentJobPage } from '@/features/job-header/hooks/useCurrentJobPage.ts';

export function JobHeaderNav({ view }: { view: JobHeaderView }) {
  const ownerChange = view.ownerChange ?? { currentUserId: null, options: [] };
  const owner = useChangeOwnerController(view.jobId, ownerChange);
  return (
    <JobHeader
      view={view}
      current={useCurrentJobPage()}
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
