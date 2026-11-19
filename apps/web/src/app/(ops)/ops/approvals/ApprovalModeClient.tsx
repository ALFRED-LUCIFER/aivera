'use client';

import { ApprovalMode } from '@/features/ops/components/ApprovalMode.tsx';
import { useApprovalModeController } from '@/features/ops/hooks/useApprovalModeController.ts';

export function ApprovalModeClient({ required }: { required: boolean }) {
  return <ApprovalMode {...useApprovalModeController(required)} />;
}
