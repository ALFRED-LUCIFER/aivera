'use client';

import { InterviewsList } from '@/features/interviews/components/InterviewsList.tsx';
import type { InterviewsData } from '@/features/interviews/domain/interviews.ts';
import { useInterviewsController } from '@/features/interviews/hooks/useInterviewsController.ts';
import { useScheduleController } from '@/features/interviews/hooks/useScheduleController.ts';
import { useStartController } from '@/features/interviews/hooks/useStartController.ts';
import type { ReactNode } from 'react';

/** `empty` stands in for the table while there is no interview at all (a job's Interviews tab, AIV-P1-165 §12). */
export function InterviewsClient({ empty, ...data }: InterviewsData & { empty?: ReactNode }) {
  const schedule = useScheduleController(data.interviewers ?? []);
  const start = useStartController();
  return (
    <InterviewsList
      view={{ ...useInterviewsController(data), schedule: data.interviewers && schedule, start }}
      empty={empty}
    />
  );
}
