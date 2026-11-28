'use client';

import { useTranslations } from '@credalent/i18n/react';
import { RankingTable } from '@/features/ranking/components/RankingTable.tsx';
import type { RankingData } from '@/features/ranking/domain/ranking.ts';
import { useChooseController } from '@/features/ranking/hooks/useChooseController.ts';
import { useDuplicatesController } from '@/features/ranking/hooks/useDuplicatesController.ts';
import { usePackController } from '@/features/ranking/hooks/usePackController.ts';
import { useRankingController } from '@/features/ranking/hooks/useRankingController.ts';

export function Ranking(data: RankingData) {
  const t = useTranslations('ranking');
  const view = useRankingController(data);
  const clearSelection = () => view.selection?.onSelectedIdsChange([]);
  const choose = useChooseController(data, t('choose.defaultReason'), clearSelection);
  const pack = usePackController(data, t('pack.defaultReason'), clearSelection);
  return (
    <RankingTable
      view={view}
      duplicates={useDuplicatesController()}
      // Each offered only when the server gave this member the action (admins and recruiters, AGENTS.md 1.3).
      choose={data.bulkActions.includes('chooseForInterview') ? choose : undefined}
      pack={data.bulkActions.includes('addToPack') ? pack : undefined}
    />
  );
}
