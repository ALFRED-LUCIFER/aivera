'use client';

import { RankingTable } from '@/features/ranking/components/RankingTable.tsx';

// The error itself is not shown or logged here: its message may carry data; the server log has it by digest.
export default function CandidatesError({ retry }: { error: unknown; retry: () => void }) {
  return <RankingTable view={{ status: 'error', onRetry: retry }} />;
}
