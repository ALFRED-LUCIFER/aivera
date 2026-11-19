'use client';

import { SettingsForm } from '@/features/settings/components/SettingsForm.tsx';
import type { WorkspaceSettings } from '@/features/settings/domain/settings.ts';
import { useSettingsController } from '@/features/settings/hooks/useSettingsController.ts';

export function SettingsClient({ settings, canEdit }: { settings: WorkspaceSettings; canEdit: boolean }) {
  return <SettingsForm view={useSettingsController(settings)} canEdit={canEdit} />;
}
