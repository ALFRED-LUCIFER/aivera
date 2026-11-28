import { describe, expect, it } from 'vitest';
import { interviewAction, neighbours, primaryAction } from './actions.ts';

// AIV-P1-165 §11, §12: the profile's one primary action, Previous / Next and "Start interview".
const JOB = '0190d4a2-0000-7000-9000-000000001031';
const may = { choose: true, pack: true };

describe('primaryAction', () => {
  it.each([
    ['new', { score: {} }, 'choose'],
    ['first_pass_done', { score: null }, 'choose'],
    ['interview', { score: {} }, 'pack'],
    // A pack holds each member's assessment, so an unscored chosen candidate has nothing to add yet.
    ['interview', { score: null }, null],
    ['interview', { score: {}, inPack: true }, null],
    // The hiring owner's decision stands: neither chosen again nor added again.
    ['round2_shortlist', { score: {} }, null],
    ['not_advanced', { score: {} }, null],
  ] as const)('stage %s %j -> %s', (stage, rest, expected) => {
    expect(primaryAction({ stage, ...rest }, may)).toBe(expected);
  });

  it('a member who may take neither action has no primary action', () => {
    expect(primaryAction({ stage: 'new', score: {} }, { choose: false, pack: false })).toBeNull();
    expect(primaryAction({ stage: 'interview', score: {} }, { choose: true, pack: false })).toBeNull();
  });

  it('a candidate the ranking does not list has none', () => {
    expect(primaryAction(undefined, may)).toBeNull();
  });
});

describe('neighbours', () => {
  const rows = [{ personId: 'a' }, { personId: 'b' }, { personId: 'c' }];

  it('follows the ranking order', () => {
    expect(neighbours(rows, 'b', JOB)).toEqual({
      previous: `/app/candidates/a?job=${JOB}`,
      next: `/app/candidates/c?job=${JOB}`,
    });
  });

  it('has no Previous at the top, no Next at the bottom, and neither when not listed', () => {
    expect(neighbours(rows, 'a', JOB).previous).toBeNull();
    expect(neighbours(rows, 'c', JOB).next).toBeNull();
    expect(neighbours(rows, 'z', JOB)).toEqual({ previous: null, next: null });
  });
});

describe('interviewAction', () => {
  it.each([
    ['to_schedule', 'start'],
    ['scheduled', 'start'],
    ['in_progress', 'open'],
    ['scorecard_due', 'open'],
  ] as const)('%s -> %s', (status, kind) => {
    expect(interviewAction({ interview: { id: 'i1', status } })).toEqual({ kind, interviewId: 'i1' });
  });

  it('offers nothing with no interview, or once it is completed or cancelled', () => {
    expect(interviewAction({})).toBeNull();
    expect(interviewAction(undefined)).toBeNull();
    expect(interviewAction({ interview: { id: 'i1', status: 'completed' } })).toBeNull();
    expect(interviewAction({ interview: { id: 'i1', status: 'cancelled' } })).toBeNull();
  });
});
