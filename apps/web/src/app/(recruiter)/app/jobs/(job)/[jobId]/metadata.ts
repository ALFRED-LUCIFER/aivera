import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import type { JobPage } from '@/features/job-header/domain/jobHeader.ts';
import { loadJob } from './loadJob.ts';

/** "Senior AI Engineer: Competencies and rubric", for a job page's title (WCAG 2.4.2); the layout loads the same job. */
export const jobPageMetadata =
  (page: JobPage) =>
  async ({ params }: { params: Promise<{ jobId: string }> }): Promise<Metadata> => {
    const t = await getTranslations(defaultLocale, defaultTimeZone);
    const loaded = await loadJob((await params).jobId);
    const stage = t(`jobHeader.stages.${page}`);
    return { title: loaded && 'header' in loaded ? `${loaded.header.job.title}: ${stage}` : stage };
  };
