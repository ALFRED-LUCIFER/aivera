'use client';

import { useAddApplicantsController } from '@/features/add-applicants';
import { ImportSources } from '@/features/import/components/ImportSources.tsx';
import type { ImportView } from '@/features/import/domain/importPage.ts';
import { useImportController } from '@/features/import/hooks/useImportController.ts';

export function ImportClient({ view, agency }: { view: ImportView; agency: boolean }) {
  const { onPick } = useImportController();
  const upload = useAddApplicantsController(view.jobId);
  return <ImportSources view={view} agency={agency} onPick={onPick} upload={{ ...upload, jobTitle: view.jobTitle }} />;
}
