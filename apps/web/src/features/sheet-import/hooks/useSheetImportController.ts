import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useDirectUpload } from '@/features/files';
import {
  completeMapping,
  isWaiting,
  peopleOf,
  POLL_MS,
  type SheetActionError,
  type SheetField,
  type SheetImportView,
} from '../domain/sheetImport.ts';
import * as actions from '../services/sheetImport.ts';

/**
 * One sheet import on a job (AIV-P1-103): the file uploaded through the files module, then the import started and its
 * id put in the URL; the page reloads while the worker reads it, the recruiter confirms the mapping, the page reloads
 * while the worker checks the rows and fetches the CV links, and "Add N people to this job" adds them. `view` is the
 * page's read of the import, null before one is started.
 */
export function useSheetImportController(jobId: string, view: SheetImportView | null, services = actions) {
  const upload = useDirectUpload('candidate_sheet');
  const router = useRouter();
  const started = useRef<string | null>(null);
  const [mapping, setMapping] = useState(view?.mapping ?? null);
  const [mappingOf, setMappingOf] = useState(view?.id);
  const [confirmed, setConfirmed] = useState(false);
  // Counted before adding: once added, the stored import no longer holds its rows (AGENTS.md 1.9).
  const [added, setAdded] = useState<number | null>(null);
  const [error, setError] = useState<SheetActionError | null>(null);
  const [pending, startTransition] = useTransition();

  // Another import (or the first read of one) arrived: start from its proposed mapping and an unticked box.
  if (view?.id !== mappingOf) {
    setMappingOf(view?.id);
    setMapping(view?.mapping ?? null);
    setConfirmed(false);
  }

  const status = view?.status;
  useEffect(() => {
    if (!isWaiting(status)) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [status, router]);

  // Once per clean upload: start the import and keep its id in the URL, so a reload finds it.
  useEffect(() => {
    if (upload.state.phase !== 'done' || started.current === upload.state.fileId) return;
    const fileId = (started.current = upload.state.fileId);
    startTransition(async () => {
      const result = await services
        .startSheetImport({ jobId, fileId })
        .catch(() => ({ ok: false, error: 'failed' }) as const);
      if (!result.ok) return setError(result.error);
      router.replace(`/app/jobs/${jobId}/import/sheet?import=${result.sheetImportId}`);
    });
  }, [upload.state, jobId, router, services]);

  const submittable = mapping && completeMapping(mapping);

  return {
    view,
    upload: upload.state,
    accept: upload.accept,
    onSelectFile(file: File) {
      setError(null);
      void upload.onSelect(file);
    },
    mapping,
    onMappingChange(field: SheetField, column: number | null) {
      setError(null);
      setMapping((current) => current && { ...current, [field]: column });
    },
    canConfirmMapping: Boolean(submittable) && !pending,
    onConfirmMapping() {
      if (!view || !submittable) return;
      startTransition(async () => {
        const result = await services
          .confirmSheetMapping({ sheetImportId: view.id, mapping: submittable })
          .catch(() => ({ ok: false, error: 'failed' }) as const);
        if (!result.ok) return setError(result.error);
        router.refresh();
      });
    },
    confirmed,
    onConfirmedChange: setConfirmed,
    /** The preview's confirm: rejects on a refusal, so the preview says nothing changed. */
    async onAdd() {
      if (!view) return;
      const count = peopleOf(view).length;
      const result = await services.addSheetImport({ sheetImportId: view.id, rightToProcessConfirmed: true });
      if (!result.ok) throw new Error(result.error);
      setAdded(count);
      router.refresh();
    },
    added,
    /** Back to choosing a file; the abandoned import adds nobody. */
    onStartOver() {
      upload.reset();
      setError(null);
      router.replace(`/app/jobs/${jobId}/import/sheet`);
    },
    pending,
    error,
  };
}

export type SheetImportController = ReturnType<typeof useSheetImportController>;
