'use client';

import { InterviewsList } from '@/features/interviews/components/InterviewsList.tsx';
import type { InterviewsData } from '@/features/interviews/domain/interviews.ts';
import { useInterviewsController } from '@/features/interviews/hooks/useInterviewsController.ts';

export function InterviewsClient(data: InterviewsData) {
  return <InterviewsList view={useInterviewsController(data)} />;
}
