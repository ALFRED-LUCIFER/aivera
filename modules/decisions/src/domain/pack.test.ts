import { describe, expect, it } from 'vitest';
import { coversMembers, mayDecide, newMembers } from './pack.ts';

// AIV-P2-009 domain rules. Opaque ids only.
const FAISAL = 'u-faisal';
const [SARA, ARJUN, HUDA] = ['c-sara', 'c-arjun', 'c-huda'] as const;

describe('mayDecide: only the authorised hiring owner decides', () => {
  const faisal = { userId: FAISAL, role: 'hiring_owner' };

  it("the job's named hiring owner may; a recruiter, another hiring owner, or anyone on a job with no owner may not", () => {
    expect(mayDecide(faisal, { hiringOwnerUserId: FAISAL })).toBe(true);
    expect(mayDecide({ userId: 'u-ayesha', role: 'recruiter' }, { hiringOwnerUserId: FAISAL })).toBe(false);
    expect(mayDecide({ userId: 'u-hassan', role: 'hiring_owner' }, { hiringOwnerUserId: FAISAL })).toBe(false);
    expect(mayDecide(faisal, { hiringOwnerUserId: null })).toBe(false);
  });

  it('a named owner who no longer holds the hiring owner role may not', () => {
    expect(mayDecide({ ...faisal, role: 'recruiter' }, { hiringOwnerUserId: FAISAL })).toBe(false);
  });
});

describe('newMembers: a candidate appears once', () => {
  it('drops a candidate already in the pack and one named twice in the same add', () => {
    const adding = [{ candidateId: SARA }, { candidateId: ARJUN }, { candidateId: ARJUN }];
    expect(newMembers([SARA], adding)).toEqual([{ candidateId: ARJUN }]);
    expect(newMembers([], [{ candidateId: SARA }, { candidateId: SARA }])).toEqual([{ candidateId: SARA }]);
  });
});

describe('coversMembers: one decision for every member', () => {
  it.each([
    ['every member once', [SARA, ARJUN, HUDA], true],
    ['a member missing', [SARA, ARJUN], false],
    ['a member twice', [SARA, ARJUN, ARJUN], false],
    ['someone not in the pack', [SARA, ARJUN, 'c-daniel'], false],
  ])('%s -> %s', (_label, decided, expected) => {
    expect(coversMembers([SARA, ARJUN, HUDA], decided)).toBe(expected);
  });
});
