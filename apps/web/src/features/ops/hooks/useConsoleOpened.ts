import { useEffect, useRef } from 'react';
import { openConsole } from '../services/openConsole.ts';

/**
 * Asks the server to record that the console was opened; the server writes it once per session. The ref stops React's
 * development double effect from sending it twice.
 * Not named useXxxController: it returns no view model, it only fires the one server action.
 * shortcut: recorded from the browser after the page loads, so a client that blocks the call opens the console
 * unrecorded; and the marker is a browser-session cookie, so a sign-in after the auth session expired (no explicit
 * sign-out) in the same browser session is not recorded again. Operator reads of workspace data (AIV-P2-036) and every
 * operator action are recorded on the server; record this on the server too if the owner wants every session counted.
 * shortcut: the server action's cookie write re-renders the session's first console page, so a link pressed meanwhile
 * waits for that re-render; set the cookie from a route handler instead if operators notice it.
 */
export function useConsoleOpened(): void {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    // A refusal (403 after removal) or a failed write changes nothing on this page; Next.js logs the server error.
    openConsole().catch(() => undefined);
  }, []);
}
