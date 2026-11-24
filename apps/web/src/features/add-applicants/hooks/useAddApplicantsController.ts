import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useDirectUpload } from '@/features/files';
import { saveFailure, type SaveFailure } from '@/features/shell/domain/saveFailure.ts';
import type { AddApplicantsResult, UploadSource } from '../domain/addApplicants.ts';
import { addApplicants } from '../services/addApplicants.ts';

export type UploadedCv = { fileId: string; name: string };

/**
 * The "Add applicants" dialog for one job: CVs uploaded one at a time through the files module, each kept once it is
 * clean, then all of them filed with the chosen source. The file name stays in the browser for the list only.
 */
export function useAddApplicantsController(jobId: string, services = { addApplicants }) {
  const upload = useDirectUpload('cv');
  const router = useRouter();
  const selected = useRef('');
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<UploadSource>('linkedin');
  const [cvs, setCvs] = useState<UploadedCv[]>([]);
  // Unticked every time: each save is its own batch and its own confirmation (AIV-P1-104).
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<AddApplicantsResult | null>(null);
  // The save threw (a 403, the network): the CVs and source stay chosen (AIV-P2-064).
  const [failure, setFailure] = useState<SaveFailure | null>(null);
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
        setSource('linkedin');
        setCvs([]);
        setConfirmed(false);
        setResult(null);
        setFailure(null);
        upload.reset();
      }
    },
    source,
    onSourceChange: (value: string) => setSource(value as UploadSource),
    upload: upload.state,
    accept: upload.accept,
    onSelectCv(file: File) {
      selected.current = file.name;
      setResult(null);
      setFailure(null);
      void upload.onSelect(file);
    },
    cvs,
    confirmed,
    onConfirmedChange: setConfirmed,
    canSubmit: cvs.length > 0 && confirmed && !busy && !pending,
    pending,
    result,
    failure,
    onSubmit() {
      startTransition(async () => {
        setFailure(null);
        let outcome;
        try {
          outcome = await services.addApplicants({
            jobId,
            rightToProcessConfirmed: true,
            source,
            fileIds: cvs.map((cv) => cv.fileId),
          });
        } catch (error) {
          return setFailure(saveFailure(error));
        }
        setResult(outcome);
        if (!outcome.ok) return;
        setCvs([]);
        setConfirmed(false);
        // The job header's "Bring in candidates" count, and the ranking, read the new applicants (AIV-P1-101).
        router.refresh();
      });
    },
  };
}

export type AddApplicantsController = ReturnType<typeof useAddApplicantsController>;
