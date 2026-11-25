import { describe, expect, it } from 'vitest';
import { inListOrder, parseView, rowAction, sameDay, type InterviewRow } from './interviews.ts';

describe('rowAction (AIV-P2-002: action per status)', () => {
  it('an interview in progress opens its scorecard', () => {
    expect(rowAction({ id: 'i1', status: 'in_progress', dueDays: null })).toEqual({
      kind: 'openScorecard',
      href: '/app/interviews/i1',
    });
  });

  it('an overdue scorecard says how many days it is due', () => {
    expect(rowAction({ id: 'i1', status: 'scorecard_due', dueDays: 2 })).toEqual({ kind: 'scorecardDue', days: 2 });
  });

  it('a scheduled interview never claims a guide: none exists until AIV-P2-003', () => {
    expect(rowAction({ id: 'i1', status: 'scheduled', dueDays: null })).toEqual({ kind: 'noGuide' });
  });

  it.each(['to_schedule', 'completed', 'cancelled'] as const)('%s offers nothing', (status) => {
    expect(rowAction({ id: 'i1', status, dueDays: null })).toBeNull();
  });
});

describe('inListOrder', () => {
  it('lists what is under way first, then coming, then overdue, then no time yet, each soonest first', () => {
    const rows = (['scorecard_due', 'scheduled', 'to_schedule', 'in_progress', 'scheduled'] as const).map(
      (status, i) => ({ id: `i${i}`, status }) as InterviewRow,
    );
    expect(inListOrder(rows).map((r) => r.id)).toEqual(['i3', 'i1', 'i4', 'i0', 'i2']);
  });
});

describe('sameDay', () => {
  it("compares the viewer's calendar day, not the UTC one", () => {
    // 22:30 UTC on 17 Nov is 02:30 on 18 Nov in Dubai.
    const lateUtc = new Date('2026-11-17T22:30:00Z');
    const noonDubai = new Date('2026-11-18T08:00:00Z');
    expect(sameDay(lateUtc, noonDubai, 'Asia/Dubai')).toBe(true);
    expect(sameDay(lateUtc, noonDubai, 'UTC')).toBe(false);
  });
});

describe('parseView', () => {
  it('is ongoing unless completed is asked for', () => {
    expect(parseView('completed')).toBe('completed');
    expect(parseView('"><script>')).toBe('ongoing');
    expect(parseView(null)).toBe('ongoing');
  });
});
