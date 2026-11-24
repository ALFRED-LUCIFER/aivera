'use client';

import { useAddApplicantsController } from '@/features/add-applicants';
import { ImportSources } from '@/features/import/components/ImportSources.tsx';
import type { ImportView } from '@/features/import/domain/importPage.ts';
import { useImportController } from '@/features/import/hooks/useImportController.ts';

export function ImportClient({ view }: { view: ImportView }) {
  return (
    <ImportSources view={view} onPick={useImportController().onPick} upload={useAddApplicantsController(view.jobId)} />
  );
}
