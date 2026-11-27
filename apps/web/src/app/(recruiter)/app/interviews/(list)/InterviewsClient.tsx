'use client';

import { InterviewsList } from '@/features/interviews/components/InterviewsList.tsx';
import type { InterviewsData } from '@/features/interviews/domain/interviews.ts';
import { useInterviewsController } from '@/features/interviews/hooks/useInterviewsController.ts';
import { useScheduleController } from '@/features/interviews/hooks/useScheduleController.ts';

export function InterviewsClient(data: InterviewsData) {
  const schedule = useScheduleController(data.interviewers ?? []);
  return <InterviewsList view={{ ...useInterviewsController(data), schedule: data.interviewers && schedule }} />;
}
