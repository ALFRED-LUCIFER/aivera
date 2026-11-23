/**
 * Why a server action the browser awaited threw instead of answering (AIV-P2-064): `forbidden()` reaches the client as
 * an error with this digest; anything else (network, a crash) is a plain failure. The value is the message key under
 * `access`. The form that called it keeps what was typed.
 */
export type SaveFailure = 'saveForbidden' | 'saveFailed';

export const saveFailure = (error: unknown): SaveFailure =>
  (error as { digest?: unknown } | null)?.digest === 'NEXT_HTTP_ERROR_FALLBACK;403' ? 'saveForbidden' : 'saveFailed';
