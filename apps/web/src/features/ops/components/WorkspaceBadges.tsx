'use client';

import { useTranslations } from '@aivera/i18n/react';
import { Chip, StatusBadge, type StatusBadgeStatus } from '@aivera/ui';
import type { WorkspaceRow } from '../domain/workspaces.ts';

const badges: Record<WorkspaceRow['status'], StatusBadgeStatus> = {
  active: 'supported',
  suspended: 'needsValidation',
  pending_approval: 'informational',
  rejected: 'contradiction',
};

/** The workspace's status with its icon and word, never colour alone (AGENTS.md 4). */
export function WorkspaceStatus({ status }: Pick<WorkspaceRow, 'status'>) {
  const t = useTranslations('ops.workspaces.status');
  return <StatusBadge status={badges[status]} label={t(status)} />;
}

/** Marks a demo or test workspace that holds only synthetic people (AGENTS.md 1.1). */
export function SyntheticBadge({ className }: { className?: string }) {
  const t = useTranslations('ops.workspaces');
  return <Chip className={className}>{t('synthetic')}</Chip>;
}
