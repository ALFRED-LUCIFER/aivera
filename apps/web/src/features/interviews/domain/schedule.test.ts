import { describe, expect, it } from 'vitest';
import { scheduleProblem, scheduleSchema, zonedToUtc } from './schedule.ts';

// AIV-P2-007: the dialog's time zone conversion and its validation.
describe('zonedToUtc', () => {
  it('reads 21 Nov, 11:00 in Dubai as 07:00 UTC', () => {
    expect(zonedToUtc('2026-11-21', '11:00', 'Asia/Dubai')?.toISOString()).toBe('2026-11-21T07:00:00.000Z');
  });

  it('settles a daylight-saving offset (London in July is UTC+1)', () => {
    expect(zonedToUtc('2026-07-01', '09:30', 'Europe/London')?.toISOString()).toBe('2026-07-01T08:30:00.000Z');
  });

  it('is null for a missing or malformed date or time', () => {
    expect(zonedToUtc('', '11:00', 'Asia/Dubai')).toBeNull();
    expect(zonedToUtc('2026-11-21', '', 'Asia/Dubai')).toBeNull();
    expect(zonedToUtc('2026-13-40', '11:00', 'Asia/Dubai')).toBeNull();
  });
});

describe('Scenario: Validation', () => {
  const now = new Date('2026-11-20T05:00:00.000Z');

  it('asks for an interviewer, then for a future time, and passes a future time with an interviewer', () => {
    expect(scheduleProblem(new Date('2026-11-21T07:00:00.000Z'), '', now)).toBe('noInterviewer');
    expect(scheduleProblem(now, 'u1', now)).toBe('pastTime');
    expect(scheduleProblem(null, 'u1', now)).toBe('pastTime');
    expect(scheduleProblem(new Date('2026-11-21T07:00:00.000Z'), 'u1', now)).toBeNull();
  });

  it('the posted input is ids, an ISO instant and the clash choice only', () => {
    const input = {
      interviewId: '0190d4a2-0000-7000-9000-000000000060',
      scheduledAt: '2026-11-21T07:00:00.000Z',
      interviewerUserId: '0190d4a2-0000-7000-9000-000000000002',
      keepClash: false,
    };
    expect(scheduleSchema.safeParse(input).success).toBe(true);
    expect(scheduleSchema.safeParse({ ...input, scheduledAt: '21 Nov 11:00' }).success).toBe(false);
    expect(scheduleSchema.safeParse({ ...input, note: 'x' }).success).toBe(false);
  });
});
