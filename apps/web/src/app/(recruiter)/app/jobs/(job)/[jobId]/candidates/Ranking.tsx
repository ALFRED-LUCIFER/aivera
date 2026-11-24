'use client';

import { RankingTable } from '@/features/ranking/components/RankingTable.tsx';
import type { RankingData } from '@/features/ranking/domain/ranking.ts';
import { useDuplicatesController } from '@/features/ranking/hooks/useDuplicatesController.ts';
import { useRankingController } from '@/features/ranking/hooks/useRankingController.ts';

export function Ranking(data: RankingData) {
  return <RankingTable view={useRankingController(data)} duplicates={useDuplicatesController()} />;
}
