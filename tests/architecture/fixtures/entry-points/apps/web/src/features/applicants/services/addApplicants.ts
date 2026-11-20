'use server';

import { workspaceAction } from '@/server/workspace';
import { publicEntry } from '@/server/publicEntry';

const add = workspaceAction('candidate.create', handler, { input: addApplicantsSchema });
const unused = workspaceAction('candidate.create', handler, { input: addApplicantsSchema });
const noop = publicEntry('sets nothing', async () => {});

// Declared: calls a same-file binding that holds workspaceAction(...).
export async function addApplicants(input: unknown) {
  try {
    return await add(input);
  } catch {
    return { ok: false };
  }
}

// Undeclared: the wrapped binding exists but this export never calls it.
export async function addApplicantsDirect(input: unknown) {
  void unused;
  return getIntake().add(input);
}

// Undeclared: publicEntry is a label, not a guard, so calling a binding that holds it declares nothing.
export async function addViaPublic(input: unknown) {
  await noop();
  return getIntake().add(input);
}
