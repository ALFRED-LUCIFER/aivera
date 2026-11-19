import { useState, useTransition } from 'react';
import {
  blankCompetency,
  starterCompetencies,
  type DraftCompetency,
  type DraftResult,
  type DraftRow,
} from '../domain/draft.ts';
import { draftCompetencies } from '../services/draftCompetencies.ts';

const withId = (c: DraftCompetency): DraftRow => ({ ...c, id: crypto.randomUUID() });

/**
 * Step 2 of Add a job: drafts competencies from step 1's form, and holds the rows the recruiter keeps, edits or removes.
 * Nothing here is saved: rows live in the page until the rubric is saved with the job (AIV-P1-010).
 */
export function useCompetencyDraftController() {
  const [result, setResult] = useState<DraftResult>({ status: 'idle' });
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();
  return {
    result,
    rows,
    editingId,
    drafting,
    /** A new draft replaces the rows; a failed one keeps what the recruiter already has. */
    onDraft: (form: HTMLFormElement) => {
      const data = new FormData(form);
      startDrafting(async () => {
        const next = await draftCompetencies(data);
        setResult(next);
        if (next.status === 'drafted') {
          setRows(next.competencies.map(withId));
          setEditingId(null);
        }
      });
    },
    /** A save shows its own field errors, not the last draft's. */
    onSaving: () => setResult((current) => (current.status === 'invalid' ? { status: 'idle' } : current)),
    onEdit: setEditingId,
    onDone: () => setEditingId(null),
    onChange: (id: string, change: Partial<DraftCompetency>) =>
      setRows((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row))),
    onRemove: (id: string) => {
      setRows((current) => current.filter((row) => row.id !== id));
      if (editingId === id) setEditingId(null);
    },
    onAdd: () => {
      const row = withId(blankCompetency());
      setRows((current) => [...current, row]);
      setEditingId(row.id);
    },
    onUseStarters: (jobType: string) => setRows((current) => [...current, ...starterCompetencies(jobType).map(withId)]),
  };
}
