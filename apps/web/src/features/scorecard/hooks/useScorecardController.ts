import {
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
import type { ScorecardData } from '../domain/scorecard.ts';
import { saveScorecardDraft } from '../services/saveDraft.ts';

/** How long after the last change the draft saves itself. */
const AUTOSAVE_MS = 1500;

/**
 * The scorecard form (AIV-P2-004): the draft the page read, kept in one object, saved by itself a moment after each
 * change and by "Save and close". Nothing here changes the assessment. "Submit scorecard" checks that every
 * competency is rated or marked as not tested and saves the draft: applying it is AIV-P2-006.
 */
// One object in useState, not React Hook Form: the form's rules are the interviews module's pure functions over the
// draft, the same ones the server runs, and React Hook Form is not a dependency of this app (AGENTS.md 4, 6.1).
export function useScorecardController(data: ScorecardData) {
  const router = useRouter();
  const [draft, setDraft] = useState(data.draft);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  // "Submit scorecard" was chosen: from then on the form says what still blocks it.
  const [checked, setChecked] = useState(false);
  const latest = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setSaving('saving');
    // A throw would reach the error boundary and take the typed notes with it.
    const saved = await saveScorecardDraft({ interviewId: data.interviewId, draft: latest.current }).catch(() => false);
    setSaving(saved ? 'saved' : 'failed');
    return saved;
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
  return {
    draft,
    saving,
    /** Competencies neither rated nor marked as not tested, once "Submit scorecard" was chosen. */
    blocked,
    /** "Submit scorecard" found nothing missing and the draft is saved. */
    complete: checked && blocked.length === 0 && saving === 'saved',
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
    onSubmit: () => {
      setChecked(true);
      void save();
    },
  };
}
