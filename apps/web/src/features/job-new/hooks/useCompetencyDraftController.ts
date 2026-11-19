import { useState, useTransition } from 'react';
import {
  blankCompetency,
  rowErrors,
  rubricJson,
  starterCompetencies,
  type DraftCompetency,
  type DraftResult,
  type DraftRow,
} from '../domain/draft.ts';
import { draftCompetencies } from '../services/draftCompetencies.ts';

const withId = (c: DraftCompetency): DraftRow => ({ ...c, id: crypto.randomUUID(), removed: false });

/**
 * Steps 2 and 3 of Add a job: drafts competencies and suggestions from step 1's form, holds the rows the recruiter
 * keeps, edits, removes or restores, and checks them before "Save job and rubric" posts them (AIV-P1-010). Nothing is
 * saved here: the rows live in the page until that save, and stay when it fails.
 */
export function useCompetencyDraftController() {
  const [result, setResult] = useState<DraftResult>({ status: 'idle' });
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();
  const [removedId, setRemovedId] = useState<string | null>(null);
  // Field errors show once a save was tried, and follow the edits from then on.
  const [checked, setChecked] = useState(false);
  return {
    result,
    rows,
    editingId,
    removedId,
    drafting,
    errors: checked ? rowErrors(rows) : {},
    /** No competency is kept, after a save was tried. */
    emptyRubric: checked && rows.every((row) => row.removed),
    /** The kept competencies as the save posts them. */
    rubric: rubricJson(rows),
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
    /**
     * Save was chosen: false blocks it while a kept competency needs a name or a weight, or none is kept, and opens the
     * first row to fix. A save shows its own field errors, not the last draft's.
     */
    onSaving: () => {
      setResult((current) => (current.status === 'invalid' ? { status: 'idle' } : current));
      setChecked(true);
      const [first] = Object.keys(rowErrors(rows));
      if (first) setEditingId(first);
      return !first && rows.some((row) => !row.removed);
    },
    onEdit: setEditingId,
    onDone: () => setEditingId(null),
    onChange: (id: string, change: Partial<DraftCompetency>) =>
      setRows((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row))),
    /** Takes the competency out of the rubric; it stays on the page with Restore (AIV-P1-009). */
    onRemove: (id: string) => {
      setRows((current) => current.map((row) => (row.id === id ? { ...row, removed: true } : row)));
      setRemovedId(id);
      if (editingId === id) setEditingId(null);
    },
    onRestore: (id: string) =>
      setRows((current) => current.map((row) => (row.id === id ? { ...row, removed: false } : row))),
    onAdd: () => {
      const row = withId(blankCompetency());
      setRows((current) => [...current, row]);
      setEditingId(row.id);
    },
    onUseStarters: (jobType: string) => setRows((current) => [...current, ...starterCompetencies(jobType).map(withId)]),
  };
}
