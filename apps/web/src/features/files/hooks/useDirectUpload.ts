import { useState } from 'react';
import { checkUpload, settledMessage, uploadRequestFor, type DirectUpload, type Purpose } from '../domain/files.ts';
import * as actions from '../services/files.ts';
import { putBlob } from '../services/putBlob.ts';

const defaults = { ...actions, putBlob, pollMs: 2000, maxPolls: 90 };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One file picker's upload (AIV-P0-016): the limits checked in the browser, then on the server; the file PUT straight
 * to Blob storage with progress; then its status polled until the scan settles it (about three minutes at most).
 * `done` carries the file id for the form that uses it.
 */
export function useDirectUpload(purpose: Purpose, services: Partial<typeof defaults> = {}) {
  const s = { ...defaults, ...services };
  const [state, setState] = useState<DirectUpload>({ phase: 'idle' });

  async function onSelect(file: File) {
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
      for (let polls = 0; status === 'pending' && polls < s.maxPolls; polls++) {
        await wait(s.pollMs);
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

  return { state, onSelect };
}
