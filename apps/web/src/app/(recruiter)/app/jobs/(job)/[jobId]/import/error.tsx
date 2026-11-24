'use client';

import { ImportFailed } from '@/features/import/components/ImportSources.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function ImportError({ retry }: { error: unknown; retry: () => void }) {
  return <ImportFailed onRetry={retry} />;
}
