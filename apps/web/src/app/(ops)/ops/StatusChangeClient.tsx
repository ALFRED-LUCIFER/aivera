'use client';

import type { StatusChange as Change } from '@aivera/workspaces';
import { StatusChange } from '@/features/ops/components/StatusChange.tsx';
import { useStatusChangeController } from '@/features/ops/hooks/useStatusChangeController.ts';

/** One status change on one workspace: the detail page's suspend or reactivate, the approvals page's approve or reject. */
export function StatusChangeClient({ workspace, change }: { workspace: { id: string; name: string }; change: Change }) {
  return <StatusChange {...useStatusChangeController(workspace, change)} />;
}
