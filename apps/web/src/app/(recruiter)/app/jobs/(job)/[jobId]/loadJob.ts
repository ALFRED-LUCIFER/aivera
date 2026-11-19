import { cache } from 'react';
import { loadJobHeader } from '@/features/job-header/services/loadJobHeader.ts';

/** One read of the job per request, shared by the layout, each page's title and the page. */
export const loadJob = cache(loadJobHeader);
