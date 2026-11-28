import { useTransition } from 'react';
import type { StartView } from '../domain/interviews.ts';
import { startInterview } from '../services/startInterview.ts';

/** "Start interview" (AIV-P1-165 §12): the action marks the interview started, then opens its scorecard. */
export function useStartController(): StartView {
  const [pending, start] = useTransition();
  return {
    pending,
    onStart: (interviewId) =>
      start(async () => {
        await startInterview(interviewId);
      }),
  };
}
