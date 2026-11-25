'use client';

import type { ReactNode } from 'react';
import { Scorecard } from '@/features/scorecard/components/Scorecard.tsx';
import type { ScorecardData } from '@/features/scorecard/domain/scorecard.ts';
import { useScorecardController } from '@/features/scorecard/hooks/useScorecardController.ts';

/** The scorecard form with its draft (AIV-P2-004); `children` is a sibling panel under the competencies. */
export function ScorecardClient({ data, children }: { data: ScorecardData; children?: ReactNode }) {
  return <Scorecard view={{ status: 'ready', ...data, ...useScorecardController(data) }}>{children}</Scorecard>;
}
