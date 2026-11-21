'use client';

import { RootError } from '@/features/shell/components/RootError.tsx';

// The root layout's provider carries only this page's two strings. The error is neither shown nor logged here; the
// server log has it by digest.
// shortcut: an error thrown in the root layout itself falls back to Next's default page; add global-error.tsx (its own
// html and body, strings passed in) when the layout does more than read the theme cookie and the catalogue.
export default function RootErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return <RootError onRetry={retry} />;
}
