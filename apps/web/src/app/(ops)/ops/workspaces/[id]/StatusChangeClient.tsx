'use client';

import type { WorkspaceStatus } from '@aivera/workspaces';
import { StatusChange } from '@/features/ops/components/StatusChange.tsx';
import { useStatusChangeController } from '@/features/ops/hooks/useStatusChangeController.ts';

export function StatusChangeClient({
  workspace,
}: {
  workspace: { id: string; name: string; status: WorkspaceStatus };
}) {
  return <StatusChange {...useStatusChangeController(workspace)} />;
}
