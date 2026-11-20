import { useState, useTransition } from 'react';
import type { CatalogueVersion } from '@aivera/jobs';
import {
  blankCompetency,
  catalogueChoices,
  changeRow,
  morePackCompetencies,
  packCompetencies,
  rowErrors,
  rubricJson,
  starterCompetencies,
  visibleRows,
  withPack,
  type DraftCompetency,
  type DraftResult,
  type DraftRow,
} from '../domain/draft.ts';
import { draftCompetencies } from '../services/draftCompetencies.ts';

const withId = (c: DraftCompetency): DraftRow => ({ ...c, id: crypto.randomUUID(), removed: false });

/**
 * Steps 2 and 3 of Add a job: drafts competencies and suggestions from step 1's form, holds the rows the recruiter
 * keeps, edits, removes or restores, with the chosen industry's pack suggestions (AIV-P1-064), and checks them before
 * "Save job and rubric" posts them (AIV-P1-010). Nothing is saved here: the rows live in the page until that save, and
 * stay when it fails. `catalogue` is the published version the page read; pack rows record its version.
 */
export function useCompetencyDraftController(catalogue: CatalogueVersion) {
  const [result, setResult] = useState<DraftResult>({ status: 'idle' });
  const [allRows, setRows] = useState<DraftRow[]>([]);
  const [industry, setIndustry] = useState<string | null>(null);
  // A regional hint the recruiter tried to make mandatory, until the next accepted change.
  const [refusedId, setRefusedId] = useState<string | null>(null);
  const rows = visibleRows(allRows, industry);
  const drafted = result.status === 'drafted' ? result : null;
  const pack = (key: string | null) =>
    key && drafted ? packCompetencies(catalogue, key, drafted.jobType, drafted.regions).map(withId) : [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();
  const [removedId, setRemovedId] = useState<string | null>(null);
  // Field errors show once a save was tried, and follow the edits from then on.
  const [checked, setChecked] = useState(false);
  return {
    result,
    rows,
    industry,
    /** The industries to choose from and the regions whose hints show, in catalogue order. */
    ...catalogueChoices(catalogue),
    /** "More from this pack", each with Add. */
    more: industry && drafted ? morePackCompetencies(catalogue, industry, drafted.jobType, allRows) : [],
    refusedId,
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
          const key = next.industry?.key ?? null;
          const suggested = key ? packCompetencies(catalogue, key, next.jobType, next.regions).map(withId) : [];
          setRows(withPack(next.competencies.map(withId), suggested));
          setIndustry(key);
          setEditingId(null);
          setRefusedId(null);
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
    onChange: (id: string, change: Partial<DraftCompetency>) => {
      const row = allRows.find((r) => r.id === id);
      const next = row && changeRow(catalogue, row, change);
      setRefusedId(row && !next ? id : null);
      if (next) setRows((current) => current.map((r) => (r.id === id ? next : r)));
    },
    /** "Not this industry" or "Add industry skills": the previous pack's suggestions give way to this one's, or none. */
    onIndustry: (key: string | null) => {
      setIndustry(key);
      setRows((current) => withPack(current, pack(key)));
      setEditingId(null);
    },
    onAddFromPack: (competency: DraftCompetency) => setRows((current) => [...current, withId(competency)]),
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
    onUseStarters: (jobType: string) =>
      setRows((current) => [...current, ...starterCompetencies(catalogue, jobType).map(withId)]),
  };
}
