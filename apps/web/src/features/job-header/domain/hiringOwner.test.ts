import { describe, expect, it } from 'vitest';
import { changeOwnerSchema, ownerChangePreview } from './hiringOwner.ts';

const OMAR = '0190d4a2-0000-7000-8000-000000000001';
const LENA = '0190d4a2-0000-7000-8000-000000000002';
const JOB = '0190d4a2-0000-7000-8000-000000000003';
const change = {
  currentUserId: OMAR,
  options: [
    { userId: OMAR, name: 'Omar Haddad' },
    { userId: LENA, name: 'Lena Fischer' },
  ],
};

describe('Change hiring owner: the form and its preview (AIV-P1-097)', () => {
  it('needs a reason and a uuid owner', () => {
    expect(changeOwnerSchema.safeParse({ jobId: JOB, ownerId: LENA, reason: ' Omar moved to Finance ' })).toMatchObject(
      {
        success: true,
        data: { reason: 'Omar moved to Finance' },
      },
    );
    expect(changeOwnerSchema.safeParse({ jobId: JOB, ownerId: LENA, reason: '  ' }).success).toBe(false);
    expect(changeOwnerSchema.safeParse({ jobId: JOB, ownerId: 'Lena', reason: 'x' }).success).toBe(false);
  });

  it('lists who gains and who loses access; assigning with no owner only gains; picking the owner changes nothing', () => {
    expect(ownerChangePreview(change, LENA)).toEqual({ gains: 'Lena Fischer', loses: 'Omar Haddad' });
    expect(ownerChangePreview({ ...change, currentUserId: null }, LENA)).toEqual({
      gains: 'Lena Fischer',
      loses: null,
    });
    expect(ownerChangePreview(change, OMAR)).toEqual({ gains: null, loses: null });
    expect(ownerChangePreview(change, '')).toEqual({ gains: null, loses: null });
  });
});
