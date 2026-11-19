'use client';

import { WorkspacesList } from '@/features/ops/components/WorkspacesList.tsx';
import type { WorkspacePage } from '@/features/ops/domain/workspaces.ts';
import { useWorkspacesController } from '@/features/ops/hooks/useWorkspacesController.ts';

export function WorkspacesClient({ initial }: { initial: WorkspacePage }) {
  return <WorkspacesList {...useWorkspacesController(initial)} />;
}
