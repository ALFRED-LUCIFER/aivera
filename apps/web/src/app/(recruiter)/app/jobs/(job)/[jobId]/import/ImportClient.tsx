'use client';

import { useAddApplicantsController } from '@/features/add-applicants';
import { ImportSources } from '@/features/import/components/ImportSources.tsx';
import type { ImportView } from '@/features/import/domain/importPage.ts';
import { useImportController } from '@/features/import/hooks/useImportController.ts';

export function ImportClient({ view }: { view: ImportView }) {
  const { onPick } = useImportController();
  const upload = useAddApplicantsController(view.jobId);
  return <ImportSources view={view} onPick={onPick} upload={{ ...upload, jobTitle: view.jobTitle }} />;
}
