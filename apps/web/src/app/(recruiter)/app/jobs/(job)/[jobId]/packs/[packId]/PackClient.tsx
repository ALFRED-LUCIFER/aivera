'use client';

import { DecisionPack } from '@/features/decision-pack/components/DecisionPack.tsx';
import type { PackPage } from '@/features/decision-pack/domain/pack.ts';
import { useNameSelfController } from '@/features/decision-pack/hooks/useNameSelfController.ts';
import { useRecordDecisionsController } from '@/features/decision-pack/hooks/useRecordDecisionsController.ts';

/**
 * The decision pack with "Record the decision" (AIV-P2-012): the hiring owner's choices live in the controller, and an
 * admin on a job with no hiring owner can name themselves first (AIV-P1-165).
 */
export function PackClient({ pack }: { pack: PackPage }) {
  const record = useRecordDecisionsController(pack);
  const nameSelf = useNameSelfController(pack.jobId);
  return <DecisionPack view={{ status: 'ready', pack }} record={record} nameSelf={nameSelf} />;
}
