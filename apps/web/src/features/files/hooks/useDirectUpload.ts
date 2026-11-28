import { useRef, useState } from 'react';
import { acceptFor, type DirectUpload, type Purpose } from '../domain/files.ts';
import { uploadDefaults, uploadFile } from '../services/uploadFile.ts';

/**
 * One file picker's upload (AIV-P0-016), run by `uploadFile`. `reset` clears it and drops an upload still running, so
 * a reopened form shows no old error. `done` carries the file id for the form that uses it. Polled by hand rather than
 * with TanStack Query: one bounded loop per upload, with no cache to share.
 */
export function useDirectUpload(purpose: Purpose, services: Partial<typeof uploadDefaults> = {}) {
  const s = { ...uploadDefaults, ...services };
  const [state, setUploadState] = useState<DirectUpload>({ phase: 'idle' });
  const run = useRef(0);

  async function onSelect(file: File) {
    const mine = ++run.current;
    // A reset or a newer file supersedes this upload: its later results are dropped.
    const alive = () => run.current === mine;
    await uploadFile(purpose, file, (next) => alive() && setUploadState(next), alive, s);
  }

  // `accept` filters the picker's dialog to the purpose's extensions; the server checks again.
  const reset = () => {
    run.current++;
    setUploadState({ phase: 'idle' });
  };

  return { state, onSelect, reset, accept: acceptFor(purpose) };
}
