'use server';

import { workspaceAction } from '@/server/workspace';

const handler = async (ctx: unknown, input: { title: string }) => getJobs().create(ctx, input);

// Declared: the call result of workspaceAction.
export const createJob = workspaceAction('job.create', handler, { input: jobSchema });
