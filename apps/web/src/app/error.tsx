'use client';

import { RootError } from '@/features/shell/components/RootError.tsx';

// The root layout's provider carries only this page's two strings. The error is neither shown nor logged here: a
// server-render error is in the server log by digest.
// shortcut: a client-side error is not logged anywhere; add client error reporting through the telemetry allowlist
// (no message text) when observability covers the browser.
// shortcut: an error thrown in the root layout itself falls back to Next's default page; add global-error.tsx (its own
// html and body, strings passed in) when the layout does more than read the theme cookie and the catalogue.
export default function RootErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return <RootError onRetry={retry} />;
}
