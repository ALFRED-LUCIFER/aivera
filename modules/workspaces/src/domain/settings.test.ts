import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettingsPatch, SettingsError, withDefaults } from './settings.ts';

describe('Scenario: A new workspace gets every approved default', () => {
  it('a workspace with nothing stored gets the owner-approved defaults', () => {
    expect(withDefaults(null)).toEqual({
      clientShareLinkDays: 14,
      invitationDays: 7,
      sessionIdleHours: 12,
      sessionMaxDays: 30,
      mergeUndoDays: 30,
      evidenceFollowUpAfterDays: 2,
      evidenceFollowUpMax: 2,
      evidencePortalLinkDays: 30,
      scorecardReminderMax: 3,
      pilotPassLinePercent: 70,
      candidateFeedbackEnabled: false,
    });
  });

  it('stored values win; a stored value no longer allowed, or an unknown key, falls back to the default', () => {
    expect(withDefaults({ clientShareLinkDays: 7, sessionIdleHours: 24, retired: 1 })).toEqual({
      ...DEFAULT_SETTINGS,
      clientShareLinkDays: 7,
    });
  });
});

describe('Scenario Outline: Values outside the allowed range are refused', () => {
  // SAFETY: mutation check: dropped .max(max) from bounded() -> the 24 and 5 cases failed (accepted)
  it.each([
    ['clientShareLinkDays', 0, 1, 30],
    ['sessionIdleHours', 24, 1, 12],
    ['evidenceFollowUpMax', 5, 0, 3],
    ['pilotPassLinePercent', 40, 50, 95],
  ])('%s = %i is refused with "must be between %i and %i"', (key, value, min, max) => {
    expect(() => parseSettingsPatch({ [key]: value })).toThrow(
      new SettingsError(`${key} must be between ${min} and ${max}`),
    );
  });

  it('the bounds themselves are allowed', () => {
    expect(parseSettingsPatch({ evidenceFollowUpMax: 0, pilotPassLinePercent: 95 })).toEqual({
      evidenceFollowUpMax: 0,
      pilotPassLinePercent: 95,
    });
  });

  it('a fraction, a string, a non-boolean switch and an unknown key are refused', () => {
    expect(() => parseSettingsPatch({ invitationDays: 7.5 })).toThrow('invitationDays must be between 1 and 30');
    expect(() => parseSettingsPatch({ invitationDays: '7' })).toThrow('invitationDays must be between 1 and 30');
    expect(() => parseSettingsPatch({ candidateFeedbackEnabled: 'yes' })).toThrow(SettingsError);
    expect(() => parseSettingsPatch({ workspaceId: 'other' })).toThrow(SettingsError);
  });
});
