import type { Source } from '@credalent/intake';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useDirectUpload } from '@/features/files';
import type { AddApplicantsResult } from '../domain/addApplicants.ts';
import { addApplicants } from '../services/addApplicants.ts';

export type UploadedCv = { fileId: string; name: string };

/**
 * The "Add applicants" dialog for one job: CVs uploaded one at a time through the files module, each kept once it is
 * clean, then all of them filed with the chosen source. The file name stays in the browser for the list only.
 */
export function useAddApplicantsController(jobId: string, services = { addApplicants }) {
  const upload = useDirectUpload('cv');
  const selected = useRef('');
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>('linkedin');
  const [cvs, setCvs] = useState<UploadedCv[]>([]);
  const [result, setResult] = useState<AddApplicantsResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Runs once per settled upload: the upload state is a new object on every change.
  useEffect(() => {
    if (upload.state.phase !== 'done') return;
    const { fileId } = upload.state;
    setCvs((list) => (list.some((cv) => cv.fileId === fileId) ? list : [...list, { fileId, name: selected.current }]));
  }, [upload.state]);

  const busy = upload.state.phase === 'uploading' || upload.state.phase === 'checking';

  return {
    open,
    onOpenChange(next: boolean) {
      setOpen(next);
      if (!next) {
        setCvs([]);
        setResult(null);
      }
    },
    source,
    onSourceChange: (value: string) => setSource(value as Source),
    upload: upload.state,
    accept: upload.accept,
    onSelectCv(file: File) {
      selected.current = file.name;
      setResult(null);
      void upload.onSelect(file);
    },
    cvs,
    canSubmit: cvs.length > 0 && !busy && !pending,
    pending,
    result,
    onSubmit() {
      startTransition(async () => {
        const outcome = await services.addApplicants({ jobId, source, fileIds: cvs.map((cv) => cv.fileId) });
        setResult(outcome);
        if (outcome.ok) setCvs([]);
      });
    },
  };
}

export type AddApplicantsController = ReturnType<typeof useAddApplicantsController>;
