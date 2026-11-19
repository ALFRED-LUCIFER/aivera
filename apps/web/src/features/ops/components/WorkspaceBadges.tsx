'use client';

import { useTranslations } from '@aivera/i18n/react';
import { Chip, StatusBadge } from '@aivera/ui';
import type { WorkspaceRow } from '../domain/workspaces.ts';

/** The workspace's status with its icon and word, never colour alone (AGENTS.md 4). */
export function WorkspaceStatus({ status }: Pick<WorkspaceRow, 'status'>) {
  const t = useTranslations('ops.workspaces.status');
  // Every workspace is active until suspension exists (AIV-P2-037), which maps its own status to a badge here.
  return <StatusBadge status="supported" label={t(status)} />;
}

/** Marks a demo or test workspace that holds only synthetic people (AGENTS.md 1.1). */
export function SyntheticBadge({ className }: { className?: string }) {
  const t = useTranslations('ops.workspaces');
  return <Chip className={className}>{t('synthetic')}</Chip>;
}
