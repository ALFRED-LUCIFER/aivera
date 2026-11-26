import {
  unexplained,
  unrated,
  type DraftCompetency,
  type Mark,
  type Rating,
  type Recommendation,
  type ScorecardDraft,
} from '@credalent/interviews';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ScorecardData, SubmitOutcome } from '../domain/scorecard.ts';
import { saveScorecardDraft } from '../services/saveDraft.ts';
import { submitScorecard } from '../services/submitScorecard.ts';

/** How long after the last change the draft saves itself. */
const AUTOSAVE_MS = 1500;

/**
 * The scorecard form (AIV-P2-004): the draft the page read, kept in one object, saved by itself a moment after each
 * change and by "Save and close". "Submit scorecard" (AIV-P2-006) checks that every competency is rated or marked as
 * not tested, with a note for each rating, saves the draft, then submits it with the preview the person saw: only the
 * submit changes the assessment, and a failed one leaves the saved draft as it was.
 */
// One object in useState, not React Hook Form: the form's rules are the interviews module's pure functions over the
// draft, the same ones the server runs, and React Hook Form is not a dependency of this app (AGENTS.md 4, 6.1).
export function useScorecardController(data: ScorecardData) {
  const router = useRouter();
  const [draft, setDraft] = useState(data.draft);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  // "Submit scorecard" was chosen: from then on the form says what still blocks it.
  const [checked, setChecked] = useState(false);
  const [outcome, setOutcome] = useState<SubmitOutcome | 'submitting' | null>(null);
  const latest = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setSaving('saving');
    // A throw would reach the error boundary and take the typed notes with it.
    const saved = await saveScorecardDraft({ interviewId: data.interviewId, draft: latest.current }).catch(() => false);
    setSaving(saved === true ? 'saved' : saved === 'closed' ? 'idle' : 'failed');
    // Submitted from another tab, or by a request that answered after it had committed: the page reads it as such.
    if (saved === 'closed') {
      setOutcome('already');
      router.refresh();
    }
    return saved === true;
  };

  // Leaving by another link within the autosave delay still saves what was typed.
  useEffect(
    () => () => {
      if (timer.current === undefined) return;
      clearTimeout(timer.current);
      void saveScorecardDraft({ interviewId: data.interviewId, draft: latest.current }).catch(() => false);
    },
    [data.interviewId],
  );

  const change = (next: ScorecardDraft) => {
    latest.current = next;
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
  };
  const changeCompetency = (competencyId: string, edit: (competency: DraftCompetency) => DraftCompetency) =>
    change({
      ...latest.current,
      competencies: latest.current.competencies.map((c) => (c.competencyId === competencyId ? edit(c) : c)),
    });

  const blocked = checked ? unrated(draft) : [];
  const noNote = checked ? unexplained(draft) : [];
  return {
    draft,
    saving,
    /** Competencies neither rated nor marked as not tested, once "Submit scorecard" was chosen. */
    blocked,
    /** Rated competencies with no note, once "Submit scorecard" was chosen. */
    noNote,
    /** How the last submit ended; `submitting` while it runs. */
    outcome,
    onRate: (competencyId: string, rating: Rating) => changeCompetency(competencyId, (c) => ({ ...c, rating })),
    onNote: (competencyId: string, note: string) => changeCompetency(competencyId, (c) => ({ ...c, note })),
    /** Marks one question; the same mark again clears it. The two marks exclude each other. */
    onMark: (competencyId: string, index: number, mark: Mark) =>
      changeCompetency(competencyId, (c) => ({
        ...c,
        questions: c.questions.map((q, i) => (i === index ? { ...q, mark: q.mark === mark ? null : mark } : q)),
      })),
    onRecommend: (recommendation: Recommendation) => change({ ...latest.current, recommendation }),
    onSaveAndClose: async () => {
      if (await save()) router.push('/app/interviews' as Route);
    },
    /** `previewId`: the preview shown for the ratings now, null with none rated (or none shown yet). */
    onSubmit: async (previewId: string | null) => {
      setChecked(true);
      if (unrated(latest.current).length > 0 || unexplained(latest.current).length > 0) return setOutcome(null);
      setOutcome('submitting');
      // Saved first, in its own transaction: a submit that fails leaves the ratings saved ("try again").
      if (!(await save())) return setOutcome((now) => (now === 'already' ? now : null));
      const ended = await submitScorecard({ interviewId: data.interviewId, previewId }).catch(() => 'failed' as const);
      setOutcome(ended);
      // Submitted (or already): the page reads the completed interview; changed: it re-reads the new snapshot to preview.
      if (['updated', 'unchanged', 'already', 'changed'].includes(ended)) router.refresh();
    },
  };
}
