'use client';

import { Tradeoffs, type TradeoffsProps } from '@/features/compare/components/Tradeoffs.tsx';
import { useTradeoffsController } from '@/features/compare/hooks/useTradeoffsController.ts';

/** "The trade-offs" with its "Write the trade-offs" action (AIV-P1-047). */
export function CompareTradeoffs(props: { jobId: string; candidateIds: string[] } & Pick<TradeoffsProps, 'columns'>) {
  const { jobId, candidateIds, columns } = props;
  return <Tradeoffs {...useTradeoffsController({ jobId, candidateIds })} columns={columns} />;
}
