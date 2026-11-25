'use client';

import { SuggestedQuestions } from '@/features/evidence-profile/components/SuggestedQuestions.tsx';
import type { QuestionsView } from '@/features/evidence-profile/domain/questions.ts';
import { useQuestionsController } from '@/features/evidence-profile/hooks/useQuestionsController.ts';

/** "Needs live verification" with its "Suggest interview questions" action (AIV-P1-113). */
export function ProfileQuestions(props: { candidateId: string; jobId: string; initial: QuestionsView }) {
  const { candidateId, jobId, initial } = props;
  return <SuggestedQuestions {...useQuestionsController({ candidateId, jobId }, initial)} />;
}
