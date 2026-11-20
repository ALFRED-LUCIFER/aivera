'use server';

// Undeclared: no wrapper and no policy guard.
export async function createJob(form: FormData) {
  return getJobs().create(form);
}

export type CreateJobState = { ok: boolean };
