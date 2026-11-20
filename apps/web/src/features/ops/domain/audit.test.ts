import { PLATFORM_ACTIONS } from '@credalent/audit';
import { intlConfig } from '@credalent/i18n';
import { describe, expect, it } from 'vitest';
import { auditHref, auditParamsSchema, auditQuery, toEntryQuery, utcMinute } from './audit.ts';

// AIV-P2-054: the audit log's URL filters. Synthetic opaque ids only.
const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const GULF = '0190d4a2-0000-7000-8000-000000000002';

describe('the filter parameters', () => {
  it('keeps every valid filter as given, in a fixed order', () => {
    const params = auditParamsSchema.parse({
      to: '2026-11-20',
      from: '2026-11-01',
      target: GULF,
      actor: PIA,
      action: 'workspace.suspended',
    });
    expect(auditQuery(params)).toBe(
      `action=workspace.suspended&actor=${PIA}&target=${GULF}&from=2026-11-01&to=2026-11-20`,
    );
  });

  // SAFETY: mutation check: made `actor` any string in auditParamsSchema -> "a name or email in place of the operator id" failed
  it.each([
    ['an empty form field', { action: '', actor: '', target: '', from: '', to: '' }],
    ['an action that is not a platform action', { action: 'rubric.approved' }],
    ['a name or email in place of the operator id', { actor: 'pia.platform@example.com' }],
    ['a target that is not an opaque id', { target: 'Gulf Talent Partners' }],
    ['a day that does not exist', { from: '2026-02-30' }],
    ['a repeated parameter', { actor: [PIA, PIA] }],
    ['an unknown parameter', { email: 'pia.platform@example.com' }],
  ])('drops %s, so the URL never carries it', (_case, raw) => {
    expect(auditHref(auditParamsSchema.parse(raw))).toBe('/ops/audit');
  });
});

describe('the contract query', () => {
  it('reads the days as UTC and includes the whole last day', () => {
    expect(
      toEntryQuery({ action: 'workspace.suspended', actor: PIA, from: '2026-11-01', to: '2026-11-20', cursor: GULF }),
    ).toEqual({
      action: 'workspace.suspended',
      actorId: PIA,
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2026-11-21T00:00:00Z'),
      cursor: GULF,
    });
    expect(toEntryQuery({})).toEqual({});
  });

  it('shows a time to the minute in UTC', () => {
    expect(utcMinute(new Date('2026-11-20T09:30:59Z'))).toBe('2026-11-20 09:30');
  });
});

// Every action written to audit.platform_entry has a human name on the page.
describe.each(PLATFORM_ACTIONS)('the action name of "%s"', (action) => {
  it('is in en.json', async () => {
    const [area = '', verb = ''] = action.split('.');
    const names: Record<string, Record<string, string>> = (await intlConfig('en', 'UTC')).messages.ops.audit
      .actionNames;
    expect(names[area]?.[verb]).toMatch(/^[A-Z]/);
  });
});
