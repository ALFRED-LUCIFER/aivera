import { useEffect, useRef } from 'react';
import { openConsole } from '../services/openConsole.ts';

/**
 * Asks the server to record that the console was opened; the server writes it once per session. The ref stops React's
 * development double effect from sending it twice.
 * shortcut: recorded from the browser after the page loads, so a client that blocks the call opens the console
 * unrecorded; operator reads of workspace data (AIV-P2-036) and every operator action are recorded on the server.
 */
export function useConsoleOpened(): void {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    // A refusal (403 after removal) or a failed write changes nothing on this page; the server logs the failure.
    openConsole().catch(() => undefined);
  }, []);
}
