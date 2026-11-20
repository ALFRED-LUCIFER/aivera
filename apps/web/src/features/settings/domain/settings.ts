// The workspace settings screen (AIV-P1-052). Pure: no React, no I/O (ADR-003). The bounds and defaults are the
// workspaces module's (AIV-P1-051); this file only groups and parses them for the form.
import {
  DEFAULT_SETTINGS,
  SETTING_BOUNDS,
  settingsSchema,
  type NumberSetting,
  type WorkspaceSettings,
} from '@credalent/workspaces';

export { DEFAULT_SETTINGS, SETTING_BOUNDS };
export type { NumberSetting, WorkspaceSettings };

export type SettingKey = keyof WorkspaceSettings;

/** The page's groups, in order; each key's label, help and unit are `settings.fields.<key>.*` in en.json. */
export const SETTING_GROUPS = [
  { id: 'sharing', keys: ['clientShareLinkDays', 'invitationDays'] },
  { id: 'signIn', keys: ['sessionIdleHours', 'sessionMaxDays'] },
  {
    id: 'candidates',
    keys: ['mergeUndoDays', 'evidenceFollowUpAfterDays', 'evidenceFollowUpMax', 'evidencePortalLinkDays'],
  },
  { id: 'interviews', keys: ['scorecardReminderMax'] },
  { id: 'value', keys: ['pilotPassLinePercent'] },
  { id: 'feedback', keys: ['candidateFeedbackEnabled'] },
] as const satisfies readonly { id: string; keys: readonly SettingKey[] }[];

/** Each numeric setting's unit, for its hint ("1 to 30 days"). */
export const SETTING_UNITS: Record<NumberSetting, 'days' | 'hours' | 'times' | 'percent'> = {
  clientShareLinkDays: 'days',
  invitationDays: 'days',
  sessionIdleHours: 'hours',
  sessionMaxDays: 'days',
  mergeUndoDays: 'days',
  evidenceFollowUpAfterDays: 'days',
  evidenceFollowUpMax: 'times',
  evidencePortalLinkDays: 'days',
  scorecardReminderMax: 'times',
  pilotPassLinePercent: 'percent',
};

/** What the form holds: numbers as typed, so "24" or "" can be shown and explained before anything is sent. */
export type SettingsFormValues = Record<NumberSetting, string> & { candidateFeedbackEnabled: boolean };

export const isNumberSetting = (key: SettingKey): key is NumberSetting => key in SETTING_BOUNDS;

export const toForm = (settings: WorkspaceSettings): SettingsFormValues => ({
  ...(Object.fromEntries(
    (Object.keys(SETTING_BOUNDS) as NumberSetting[]).map((key) => [key, String(settings[key])]),
  ) as Record<NumberSetting, string>),
  candidateFeedbackEnabled: settings.candidateFeedbackEnabled,
});

/** The settings to save, or the numeric fields out of range (each shown "Enter a number from <min> to <max>"). */
export function parseForm(form: SettingsFormValues): { settings: WorkspaceSettings } | { invalid: NumberSetting[] } {
  const invalid = (Object.keys(SETTING_BOUNDS) as NumberSetting[]).filter((key) => {
    const text = form[key].trim();
    return !/^\d+$/.test(text) || !settingsSchema.shape[key].safeParse(Number(text)).success;
  });
  if (invalid.length > 0) return { invalid };
  const settings = { ...form } as Record<string, unknown>;
  for (const key of Object.keys(SETTING_BOUNDS)) settings[key] = Number(form[key as NumberSetting]);
  return { settings: settingsSchema.parse(settings) };
}

/** Whether the field differs from the approved default, so it shows "Default: N" and "Use default". */
export const changedFromDefault = (form: SettingsFormValues, key: SettingKey) =>
  String(form[key]).trim() !== String(DEFAULT_SETTINGS[key]);

export type SettingsStatus = 'idle' | 'saving' | 'saved' | 'failed';

/** The form's view model: the values as typed, the fields out of range, the save state and the handlers. */
export type SettingsView = {
  form: SettingsFormValues;
  invalid: NumberSetting[];
  status: SettingsStatus;
  onChange: (key: SettingKey, value: string | boolean) => void;
  onUseDefault: (key: SettingKey) => void;
  onSave: () => Promise<void>;
};
