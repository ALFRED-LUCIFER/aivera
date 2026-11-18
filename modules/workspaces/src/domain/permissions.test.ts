import { describe, expect, it } from 'vitest';
import { grantsCover } from './permissions.ts';

const DUNE = 'client-dune';
const FALCON = 'client-falcon';
const jobGrant = (jobId: string) => [{ jobId, clientId: null }];
const clientGrant = (clientId: string) => [{ jobId: null, clientId }];

describe("grantsCover: a grant covers a job when it names that job or the job's client", () => {
  it.each([
    ['a job grant, on that job', jobGrant('J1'), { jobId: 'J1', clientId: DUNE }, true],
    ['a job grant, on another job of the same client', jobGrant('J1'), { jobId: 'J4', clientId: DUNE }, false],
    ['a client grant, on a job of that client', clientGrant(DUNE), { jobId: 'J3', clientId: DUNE }, true],
    ["a client grant, on another client's job", clientGrant(DUNE), { jobId: 'J2', clientId: FALCON }, false],
    ['a client grant, on a team job (no client)', clientGrant(DUNE), { jobId: 'J5', clientId: null }, false],
    ['a client grant, on a job whose client is not given', clientGrant(DUNE), { jobId: 'J5' }, false],
    ['no grants', [], { jobId: 'J1', clientId: DUNE }, false],
  ])('%s: covered = %s', (_label, grants, resource, covered) => {
    expect(grantsCover(grants, resource)).toBe(covered);
  });
});
