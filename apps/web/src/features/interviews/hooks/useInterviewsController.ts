import { useState } from 'react';
import type { InterviewsData, InterviewView } from '../domain/interviews.ts';

/** The Interviews list: which tab is open, its rows and each tab's count. Both lists arrive whole from the server. */
// shortcut: the tab lives in state, not the URL; move it to the URL if people ask to link the Completed tab.
export function useInterviewsController({ ongoing, completed, people, jobs }: InterviewsData) {
  const [view, setView] = useState<InterviewView>('ongoing');
  return {
    status: 'ready' as const,
    view,
    onViewChange: setView,
    rows: view === 'completed' ? completed : ongoing,
    counts: { ongoing: ongoing.length, completed: completed.length },
    people,
    jobs,
  };
}
