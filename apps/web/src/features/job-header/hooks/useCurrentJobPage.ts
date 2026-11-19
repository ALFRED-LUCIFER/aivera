import { useSelectedLayoutSegment } from 'next/navigation';
import { parseJobPage } from '../domain/jobHeader.ts';

/** The job page open under the job layout, for the stage tabs' aria-current. */
export const useCurrentJobPage = () => parseJobPage(useSelectedLayoutSegment());
