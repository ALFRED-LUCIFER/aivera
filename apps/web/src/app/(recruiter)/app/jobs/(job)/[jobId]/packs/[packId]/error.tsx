'use client';

import { DecisionPack } from '@/features/decision-pack/components/DecisionPack.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function PackError({ retry }: { error: unknown; retry: () => void }) {
  return <DecisionPack view={{ status: 'error', onRetry: retry }} />;
}
