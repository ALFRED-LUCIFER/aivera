import type { NewPlatformEntry } from '@credalent/audit';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APPROVAL_REQUIRED, OpsError } from '../domain/settings.ts';
import { settingsUseCases, type SettingsStore } from './settings.ts';

// AIV-P2-039: the approval switch, against a faked store that logs each write in order. Synthetic ids.
const THEO = '0190d4a2-0000-7000-8000-00000000a002';

function setup(stored: boolean | null) {
  const writes: string[] = [];
  const store: SettingsStore = {
    approvalRequired: async () => stored,
    setApprovalRequired: async (required) => void writes.push(`set ${required}`),
    recordPlatform: async (entry: NewPlatformEntry) =>
      void writes.push(
        `audit ${entry.action} ${JSON.stringify(entry.before)}→${JSON.stringify(entry.after)}: ${entry.note}`,
      ),
  };
  return { writes, settings: settingsUseCases({ inTransaction: (work) => work(store) }) };
}

describe('the approval switch', () => {
  it('is on by default for the pilot', async () => {
    expect(DEFAULT_APPROVAL_REQUIRED).toBe(true);
    expect(await setup(null).settings.approvalRequired()).toBe(true);
    expect(await setup(false).settings.approvalRequired()).toBe(false);
  });

  it('Scenario: Changing the switch is audited: the setting, then the platform entry from on to off, last', async () => {
    const { writes, settings } = setup(true);
    await settings.setApprovalRequired({ operatorId: THEO, required: false, reason: ' Pilot open to all ' });
    expect(writes).toEqual([
      'set false',
      'audit ops.approval_mode_changed {"approvalRequired":true}→{"approvalRequired":false}: Pilot open to all',
    ]);
  });

  it.each([
    ['a reason under 10 characters', true, false, 'too short', 'reason_required'],
    ['a value it already has', true, true, 'Pilot needs approval', 'unchanged'],
  ] as const)('refuses %s and writes nothing', async (_label, stored, required, reason, code) => {
    const { writes, settings } = setup(stored);
    await expect(settings.setApprovalRequired({ operatorId: THEO, required, reason })).rejects.toEqual(
      new OpsError(code),
    );
    expect(writes).toEqual([]);
  });
});
