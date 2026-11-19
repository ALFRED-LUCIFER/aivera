// Workspace settings (AIV-P1-051): the timings and limits the owner approved as defaults, each bounded. The single
// source of truth for the bounds; the settings screen (AIV-P1-052) reads them through the contracts.
import { z } from 'zod';

/** Every numeric setting: its approved default and the allowed range, inclusive. */
export const SETTING_BOUNDS = {
  clientShareLinkDays: { default: 14, min: 1, max: 30 },
  invitationDays: { default: 7, min: 1, max: 30 },
  // Can only shorten the platform's own session limits (AIV-P0-009).
  sessionIdleHours: { default: 12, min: 1, max: 12 },
  sessionMaxDays: { default: 30, min: 1, max: 30 },
  mergeUndoDays: { default: 30, min: 1, max: 90 },
  evidenceFollowUpAfterDays: { default: 2, min: 1, max: 7 },
  evidenceFollowUpMax: { default: 2, min: 0, max: 3 },
  evidencePortalLinkDays: { default: 30, min: 7, max: 60 },
  scorecardReminderMax: { default: 3, min: 0, max: 5 },
  pilotPassLinePercent: { default: 70, min: 50, max: 95 },
} as const;

export type NumberSetting = keyof typeof SETTING_BOUNDS;

const bounded = (key: NumberSetting) => {
  const { min, max } = SETTING_BOUNDS[key];
  const error = `${key} must be between ${min} and ${max}`;
  return z.number({ error }).int({ error }).min(min, { error }).max(max, { error });
};

const numbers = Object.fromEntries(
  Object.keys(SETTING_BOUNDS).map((key) => [key, bounded(key as NumberSetting)]),
) as Record<NumberSetting, z.ZodNumber>;

/** A workspace's settings, every key present. */
export const settingsSchema = z.object({
  ...numbers,
  candidateFeedbackEnabled: z.boolean({ error: 'candidateFeedbackEnabled must be true or false' }),
});

export type WorkspaceSettings = z.infer<typeof settingsSchema>;

/** A change to some settings; an unknown key is refused. */
export const settingsPatchSchema = settingsSchema.partial().strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  ...(Object.fromEntries(Object.entries(SETTING_BOUNDS).map(([key, b]) => [key, b.default])) as Record<
    NumberSetting,
    number
  >),
  candidateFeedbackEnabled: false,
};

/** A refused settings change, with the first reason ("clientShareLinkDays must be between 1 and 30"). */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

/** The patch, validated; throws `SettingsError` for a value out of range, of the wrong type, or an unknown key. */
export function parseSettingsPatch(patch: unknown): SettingsPatch {
  const result = settingsPatchSchema.safeParse(patch);
  if (!result.success) throw new SettingsError(result.error.issues[0]?.message ?? 'Invalid settings');
  return result.data;
}

/** Stored values over the defaults. A stored value no longer allowed (bounds narrowed later) falls back to its default. */
export function withDefaults(stored: Record<string, unknown> | null): WorkspaceSettings {
  const merged = { ...DEFAULT_SETTINGS };
  for (const [key, value] of Object.entries(stored ?? {})) {
    const parsed = settingsPatchSchema.safeParse({ [key]: value });
    if (parsed.success) Object.assign(merged, parsed.data);
  }
  return merged;
}
