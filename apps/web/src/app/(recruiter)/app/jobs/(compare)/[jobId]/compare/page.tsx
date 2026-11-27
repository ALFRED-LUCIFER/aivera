import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import { forbidden, notFound } from 'next/navigation';
import { Compare } from '@/features/compare/components/Compare.tsx';
import { loadCompare } from '@/features/compare/services/loadCompare.ts';
import { CompareTradeoffs } from './CompareTradeoffs.tsx';

// The title names the page, never the people compared: it reaches the browser's history (AGENTS.md 1.2).
export const generateMetadata = async (): Promise<Metadata> => ({
  title: (await getTranslations(defaultLocale, defaultTimeZone))('compare.title'),
});

// The comparison of a job's candidates (AIV-P1-047), at /app/jobs/[jobId]/compare?ids=[person ids]. Outside the (job)
// group: the Compare artboard has its own breadcrumb and title, not the job header and its stages. No requireScreen:
// a job's granted hiring owners open it too, and loadCompare decides through the member's job scope (403 for an
// ungranted job, 404 for a job the workspace does not have).
export default async function ComparePage({ params, searchParams }: PageProps<'/app/jobs/[jobId]/compare'>) {
  const { jobId } = await params;
  const compare = await loadCompare(jobId, (await searchParams)['ids']);
  // No workspace: the recruiter layout shows the create-workspace page instead.
  if (!compare) return null;
  if (compare === 'forbidden') forbidden();
  if (compare === 'notFound') notFound();
  return (
    <Compare view={compare}>
      {compare.status === 'ready' && compare.rows.length > 0 && (
        // Keyed by the selection: another selection (only `?ids=` changes) starts with nothing written.
        <CompareTradeoffs
          key={compare.columns.map((c) => c.candidateId).join()}
          jobId={jobId}
          candidateIds={compare.columns.map((c) => c.candidateId)}
          columns={compare.columns.map(({ score }) => ({ score }))}
        />
      )}
    </Compare>
  );
}
