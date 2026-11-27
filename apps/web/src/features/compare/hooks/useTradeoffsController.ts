import { useState, useTransition } from 'react';
import type { TradeoffsView } from '../domain/compare.ts';
import { writeTradeoffs } from '../services/writeTradeoffs.ts';

/**
 * "The trade-offs" (AIV-P1-047): nothing until a person asks, then what the server wrote or "unavailable". A click asks
 * the server once; asking again replaces what is shown.
 */
export function useTradeoffsController(ids: { jobId: string; candidateIds: string[] }) {
  const [view, setView] = useState<TradeoffsView | null>(null);
  const [pending, startWriting] = useTransition();
  return {
    view,
    pending,
    onWrite: () =>
      startWriting(async () => {
        try {
          setView(await writeTradeoffs(ids));
        } catch {
          // A throw would reach the error boundary and take the grid with it.
          setView({ status: 'unavailable' });
        }
      }),
  };
}
