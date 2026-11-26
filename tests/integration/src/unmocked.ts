// shortcut: HttpNetworkFrame is from msw's experimental entry point (msw 3.0); move to its stable export when msw has one.
import { HttpNetworkFrame } from 'msw/experimental';

/**
 * msw's `onUnhandledFrame` for a test whose only outside hosts are fixtures: a request to one of `hosts` that no
 * handler answers fails as a network error, so it can never pass through; other traffic (Testcontainers' Docker API
 * calls) does. msw 3's `defaults.error()` only prints, where msw 2's `print.error()` also failed the request.
 */
export const failUnmocked =
  (...hosts: string[]) =>
  async ({ frame, defaults }: { frame: unknown; defaults: { error: () => void } }): Promise<void> => {
    if (!(frame instanceof HttpNetworkFrame && hosts.some((host) => frame.data.request.url.startsWith(host)))) return;
    defaults.error();
    // msw answers a rejection that is a Response with that response; Response.error() is a network error.
    return Promise.reject(Response.error());
  };
