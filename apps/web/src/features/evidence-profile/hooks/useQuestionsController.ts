import { useState, useTransition } from 'react';
import type { QuestionsView, SuggestOutcome } from '../domain/questions.ts';
import { suggestQuestions } from '../services/suggestQuestions.ts';

/**
 * "Needs live verification" (AIV-P1-113): the stored questions the page read, and "Suggest interview questions", which
 * asks the server once a click. A refusal (today's AI allowance, a rejected answer) keeps what is on the page and
 * says why.
 */
export function useQuestionsController(ids: { candidateId: string; jobId: string }, initial: QuestionsView) {
  const [view, setView] = useState(initial);
  const [problem, setProblem] = useState<'waiting' | 'failed' | null>(null);
  const [pending, startSuggesting] = useTransition();
  return {
    view,
    problem,
    pending,
    onSuggest: () =>
      startSuggesting(async () => {
        let next: SuggestOutcome;
        try {
          next = await suggestQuestions(ids);
        } catch {
          // A throw would reach the error boundary and take the profile with it.
          next = { status: 'failed' };
        }
        if (next.status === 'waiting' || next.status === 'failed') setProblem(next.status);
        else {
          setProblem(null);
          setView(next);
        }
      }),
  };
}
