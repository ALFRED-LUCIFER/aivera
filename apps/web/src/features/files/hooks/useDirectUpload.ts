import { useRef, useState } from 'react';
import {
  acceptFor,
  checkUpload,
  settledMessage,
  uploadRequestFor,
  type DirectUpload,
  type Purpose,
} from '../domain/files.ts';
import * as actions from '../services/files.ts';
import { putBlob } from '../services/putBlob.ts';

const defaults = { ...actions, putBlob, pollMs: 2000, maxPolls: 90 };
// shortcut: a scan still pending after ten times the usual wait (about 30 minutes) is shown as failed; poll on if the
// scanner's real worst case is ever longer.
const GIVE_UP = 10;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One file picker's upload (AIV-P0-016): the limits checked in the browser, then on the server; the file PUT straight
 * to Blob storage with progress; then its status polled until the scan settles it, usually within three minutes; after
 * that it shows "Still checking this file" and keeps polling (AIV-P2-064). `reset` clears it and drops an upload still
 * running, so a reopened form shows no old error.
 * `done` carries the file id for the form that uses it. Polled by hand rather than with TanStack Query: one bounded
 * loop per upload, with no cache to share.
 */
export function useDirectUpload(purpose: Purpose, services: Partial<typeof defaults> = {}) {
  const s = { ...defaults, ...services };
  const [state, setUploadState] = useState<DirectUpload>({ phase: 'idle' });
  const run = useRef(0);

  async function onSelect(file: File) {
    const mine = ++run.current;
    // A reset or a newer file supersedes this upload: its later results are dropped.
    const setState = (next: DirectUpload) => {
      if (run.current === mine) setUploadState(next);
    };
    const request = uploadRequestFor(purpose, file);
    const refused = checkUpload(request);
    if (refused) return setState({ phase: 'error', message: refused });
    setState({ phase: 'uploading', percent: 0 });
    try {
      const ticket = await s.requestUpload(request);
      if (!ticket.ok) return setState({ phase: 'error', message: ticket.error });
      const stored = await s.putBlob(ticket.uploadUrl, file, request.contentType, (percent) =>
        setState({ phase: 'uploading', percent }),
      );
      if (!stored) return setState({ phase: 'error', message: 'failed' });
      setState({ phase: 'checking' });
      let status = await s.completeUpload(ticket.fileId);
      for (let polls = 0; status === 'pending' && polls < s.maxPolls * GIVE_UP; polls++) {
        if (polls === s.maxPolls) setState({ phase: 'checking', slow: true });
        await wait(s.pollMs);
        if (run.current !== mine) return;
        status = await s.uploadStatus(ticket.fileId);
      }
      setState(
        status === 'clean'
          ? { phase: 'done', fileId: ticket.fileId }
          : { phase: 'error', message: settledMessage(status) },
      );
    } catch {
      setState({ phase: 'error', message: 'failed' });
    }
  }

  // `accept` filters the picker's dialog to the purpose's extensions; the server checks again.
  const reset = () => {
    run.current++;
    setUploadState({ phase: 'idle' });
  };

  return { state, onSelect, reset, accept: acceptFor(purpose) };
}
