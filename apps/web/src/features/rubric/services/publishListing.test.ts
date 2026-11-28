import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishListing } from './publishListing.ts';

// AIV-P1-165 Scenario Outline: Send actions are off the pilot path ("Publish on Credalent jobs" on the rubric page).

const JOB = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
let outbound = false;
const publishJob = vi.fn(async () => undefined);
const unpublishJob = vi.fn(async () => undefined);

vi.mock('@/server/notifications', () => ({ outboundOn: () => outbound }));
vi.mock('@/server/jobs', () => ({ getJobs: () => ({ publishJob, unpublishJob }) }));
vi.mock('@/server/workspace', () => ({
  inActiveWorkspace: async (fn: (ctx: object) => Promise<unknown>) => ({ value: await fn({}) }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({ forbidden: () => undefined, unstable_rethrow: () => undefined }));

beforeEach(() => {
  vi.clearAllMocks();
  outbound = false;
});

describe('Where sending is off, nothing is published', () => {
  // SAFETY: mutation check: removed the outboundOn() check in publishListing -> this test failed (publishJob called)
  it('a publish is refused before the jobs module is called', async () => {
    await expect(publishListing({ jobId: JOB, publicDescriptor: 'A BNPL fintech' })).resolves.toEqual({
      error: 'failed',
    });
    expect(publishJob).not.toHaveBeenCalled();
  });

  it('unpublishing still works', async () => {
    await expect(publishListing({ jobId: JOB })).resolves.toEqual({ ok: true });
    expect(unpublishJob).toHaveBeenCalledOnce();
  });

  it('where sending is on, the job is published', async () => {
    outbound = true;
    await expect(publishListing({ jobId: JOB, publicDescriptor: 'A BNPL fintech' })).resolves.toEqual({ ok: true });
    expect(publishJob).toHaveBeenCalledOnce();
  });
});
