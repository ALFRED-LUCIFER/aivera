import { checkUpload, settledMessage, uploadRequestFor, type DirectUpload, type Purpose } from '../domain/files.ts';
import * as actions from './files.ts';
import { putBlob } from './putBlob.ts';

export const uploadDefaults = { ...actions, putBlob, pollMs: 2000, maxPolls: 90 };
// shortcut: a scan still pending after ten times the usual wait (about 30 minutes) is shown as failed; poll on if the
// scanner's real worst case is ever longer.
const GIVE_UP = 10;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One file's upload (AIV-P0-016): the limits checked in the browser, then on the server; the file PUT straight to Blob
 * storage with progress; then its status polled until the scan settles it, usually within three minutes; after that
 * `checking` turns `slow` and polling goes on (AIV-P2-064). Polling stops once `alive` turns false (a reset, a newer
 * file, a closed dialog). The file's bytes never pass through the web app: no server action carries them.
 */
export async function uploadFile(
  purpose: Purpose,
  file: File,
  setState: (next: DirectUpload) => void,
  alive: () => boolean,
  s: typeof uploadDefaults = uploadDefaults,
): Promise<void> {
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
      if (!alive()) return;
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
