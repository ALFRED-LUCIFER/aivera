import { useState } from 'react';
import {
  DEFAULT_SETTINGS,
  parseForm,
  toForm,
  type NumberSetting,
  type SettingKey,
  type SettingsForm,
  type SettingsStatus,
  type SettingsView,
  type WorkspaceSettings,
} from '../domain/settings.ts';
import { saveSettings } from '../services/saveSettings.ts';

/**
 * The settings form (AIV-P1-052): the values as typed, the fields out of range, and saving. A value out of range is
 * explained and nothing is sent; a failed save keeps the edits in the form.
 */
export function useSettingsController(saved: WorkspaceSettings, save = saveSettings): SettingsView {
  const [form, setForm] = useState<SettingsForm>(() => toForm(saved));
  const [invalid, setInvalid] = useState<NumberSetting[]>([]);
  const [status, setStatus] = useState<SettingsStatus>('idle');
  const set = (key: SettingKey, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  return {
    form,
    invalid,
    status,
    onChange: set,
    onUseDefault: (key: SettingKey) => set(key, toForm(DEFAULT_SETTINGS)[key]),
    async onSave() {
      const parsed = parseForm(form);
      if ('invalid' in parsed) {
        setInvalid(parsed.invalid);
        setStatus('idle');
        return;
      }
      setInvalid([]);
      setStatus('saving');
      try {
        setForm(toForm(await save(parsed.settings)));
        setStatus('saved');
      } catch {
        setStatus('failed');
      }
    },
  };
}
