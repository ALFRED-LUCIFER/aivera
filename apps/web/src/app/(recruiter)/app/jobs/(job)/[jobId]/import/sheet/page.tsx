import { SheetImport } from '@/features/sheet-import/components/SheetImport.tsx';
import { loadSheetImport } from '@/features/sheet-import/services/loadSheetImport.ts';
import { loadJob } from '../../loadJob.ts';
import { jobPageMetadata } from '../../metadata.ts';
import { SheetImportClient } from './SheetImportClient.tsx';

export const generateMetadata = jobPageMetadata('import');

// Import candidates from a CSV or Excel file (AIV-P1-103). The job comes from the layout's own read (loadJob, through
// the member's job scope), so another workspace's job is the layout's 404 and an ungranted one its 403. `?import=` names
// the member's own import in progress; any other id reads as none.
export default async function SheetImportPage({ params, searchParams }: PageProps<'/app/jobs/[jobId]/import/sheet'>) {
  const loaded = await loadJob((await params).jobId);
  // No workspace, or not found or forbidden: the layout renders that instead.
  if (!loaded || 'missing' in loaded) return null;
  if (!loaded.canImport) return <SheetImport readOnly />;
  const { job } = loaded.header;
  const view = await loadSheetImport((await searchParams).import, job.id);
  return <SheetImportClient jobId={job.id} jobTitle={job.title} view={view} />;
}
