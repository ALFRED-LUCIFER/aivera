import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { uploadFile } from '@/features/files';
import { acceptFor, type DirectUpload } from '@/features/files/domain/files.ts';
import { jobPageHref } from '@/features/job-header/domain/jobHeader.ts';
import { saveFailure, type SaveFailure } from '@/features/shell/domain/saveFailure.ts';
import { withinSave, type AddApplicantsResult, type CvRow, type UploadSource } from '../domain/addApplicants.ts';
import { addApplicants } from '../services/addApplicants.ts';

// A few uploads at a time: each is a handful of server actions plus a status poll every 2 s, and Next.js runs a tab's
// server actions one after another, so 30 at once would queue every other request of the tab behind them. One queue
// serves every pick of the dialog session, so a second pick does not double it.
// shortcut: a slot is held through the malware scan's polling, so with scanning on 30 CVs take about ten scan rounds;
// CVs already clean can be saved meanwhile. Free the slot once the file is stored if pilot uploads prove slow.
const AT_ONCE = 3;

/**
 * The Add CVs dialog for one job (AIV-P1-019, AIV-P1-165): several CVs per pick, each uploaded straight to Blob storage
 * through the files module and listed by its name with its own result, then the clean ones filed with the chosen
 * source in one save of up to 200. The file names stay in the browser for the list only.
 */
export function useAddApplicantsController(jobId: string, services = { addApplicants, uploadFile }) {
  const router = useRouter();
  // Bumped when the dialog closes: uploads still running stop, and their results are dropped.
  const session = useRef(0);
  const keys = useRef(0);
  const queue = useRef<{ key: string; file: File }[]>([]);
  const workers = useRef(0);
  const [open, setOpen] = useState(false);
  // No default: the recruiter says where these CVs came from (AIV-P1-165).
  const [source, setSource] = useState<UploadSource | null>(null);
  const [rows, setRows] = useState<CvRow[]>([]);
  const [over, setOver] = useState(0);
  // Ticked once, it stays ticked for this dialog session, every save a batch of its own; reopened, it is unticked.
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<AddApplicantsResult | null>(null);
  // The save threw (a 403, the network): the CVs and source stay chosen (AIV-P2-064).
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = rows.flatMap((r) =>
    r.upload.phase === 'done' && !r.added ? [{ key: r.key, fileId: r.upload.fileId }] : [],
  );
  const busy = rows.some(
    (r) => r.upload.phase === 'idle' || r.upload.phase === 'uploading' || r.upload.phase === 'checking',
  );

  return {
    open,
    onOpenChange(next: boolean) {
      setOpen(next);
      if (!next) {
        session.current++;
        queue.current = [];
        setSource(null);
        setRows([]);
        setOver(0);
        setConfirmed(false);
        setResult(null);
        setFailure(null);
      }
    },
    source: source ?? '',
    onSourceChange: (value: string) => setSource(value as UploadSource),
    accept: acceptFor('cv'),
    onSelectCvs(files: File[]) {
      const { take, over: left } = withinSave(files, rows);
      const picked = take.map((file) => ({ key: String(keys.current++), file }));
      const listed: CvRow[] = picked.map(({ key, file }) => ({ key, name: file.name, upload: { phase: 'idle' } }));
      setRows((list) => [...list, ...listed]);
      setOver(left);
      setResult(null);
      setFailure(null);
      const mine = session.current;
      const alive = () => session.current === mine;
      const patch = (key: string) => (upload: DirectUpload) => {
        if (alive()) setRows((list) => list.map((r) => (r.key === key ? { ...r, upload } : r)));
      };
      queue.current.push(...picked);
      const worker = async () => {
        workers.current++;
        try {
          while (alive()) {
            const next = queue.current.shift();
            if (!next) return;
            await services.uploadFile('cv', next.file, patch(next.key), alive);
          }
        } finally {
          workers.current--;
        }
      };
      for (let i = workers.current; i < AT_ONCE; i++) void worker();
    },
    rows,
    over,
    readyCount: ready.length,
    confirmed,
    onConfirmedChange: setConfirmed,
    // CVs already clean can be saved while others are still uploading or being checked; each save takes the ready ones.
    canSubmit: ready.length > 0 && source !== null && confirmed && !pending,
    pending,
    result,
    failure,
    // After a save, with nothing new waiting, the one primary action is the ranking (AIV-P1-165).
    sheetHref: `${jobPageHref(jobId, 'import')}/sheet`,
    rankingHref: rows.some((r) => r.added) && ready.length === 0 && !busy ? jobPageHref(jobId, 'candidates') : null,
    onSubmit() {
      if (!source) return;
      startTransition(async () => {
        setFailure(null);
        let outcome;
        try {
          outcome = await services.addApplicants({
            jobId,
            rightToProcessConfirmed: true,
            source,
            fileIds: ready.map((r) => r.fileId),
          });
        } catch (error) {
          return setFailure(saveFailure(error));
        }
        setResult(outcome);
        if (!outcome.ok) return;
        // Intake answers in the order the CVs were sent.
        const added = new Map(
          ready.map((r, i) => [r.key, outcome.applications[i]?.created === false ? 'sourceAdded' : 'created'] as const),
        );
        setRows((list) =>
          list.map((r) => {
            const outcomeOf = added.get(r.key);
            return outcomeOf ? { ...r, added: outcomeOf } : r;
          }),
        );
        // The job header's Add CVs count, and the ranking, read the new applicants (AIV-P1-101).
        router.refresh();
      });
    },
  };
}

export type AddApplicantsController = ReturnType<typeof useAddApplicantsController>;
