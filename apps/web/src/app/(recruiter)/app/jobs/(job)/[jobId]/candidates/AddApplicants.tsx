'use client';

import { AddApplicantsDialog, useAddApplicantsController } from '@/features/add-applicants';

export function AddApplicants({ jobId }: { jobId: string }) {
  return <AddApplicantsDialog {...useAddApplicantsController(jobId)} />;
}
