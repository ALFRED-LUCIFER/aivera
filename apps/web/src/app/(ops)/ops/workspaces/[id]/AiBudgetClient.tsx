'use client';

import { AiBudgetForm } from '@/features/ops/components/AiBudgetForm.tsx';
import { AiTokenUse } from '@/features/ops/components/AiTokenUse.tsx';
import type { WorkspaceRow } from '@/features/ops/domain/workspaces.ts';
import { useAiBudgetController } from '@/features/ops/hooks/useAiBudgetController.ts';

// AIV-P2-038: the AI token use card, with the budget form once the use could be read.
export function AiBudgetClient({ workspaceId, ai }: { workspaceId: string; ai: WorkspaceRow['ai'] }) {
  return ai ? <WithForm workspaceId={workspaceId} ai={ai} /> : <AiTokenUse ai={null} />;
}

function WithForm({ workspaceId, ai }: { workspaceId: string; ai: NonNullable<WorkspaceRow['ai']> }) {
  return (
    <AiTokenUse ai={ai}>
      <AiBudgetForm overridden={ai.overridden} view={useAiBudgetController(workspaceId, ai)} />
    </AiTokenUse>
  );
}
