'use client';

import type { ComponentProps } from 'react';
import { NewJobForm } from '@/features/job-new/components/NewJobForm.tsx';
import { useNewJobController } from '@/features/job-new/hooks/useNewJobController.ts';

type Props = Pick<
  ComponentProps<typeof NewJobForm>,
  'labels' | 'jobTypes' | 'hiringOwners' | 'clients' | 'membersHref'
> & { defaultJobType: string };

export function NewJob({ defaultJobType, ...props }: Props) {
  return <NewJobForm {...props} {...useNewJobController(defaultJobType)} />;
}
