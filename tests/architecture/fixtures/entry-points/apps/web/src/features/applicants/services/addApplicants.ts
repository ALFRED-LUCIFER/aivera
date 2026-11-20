'use server';

import { workspaceAction } from '@/server/workspace';

const add = workspaceAction('candidate.create', handler, { input: addApplicantsSchema });
const unused = workspaceAction('candidate.create', handler, { input: addApplicantsSchema });
const unreasoned = publicEntry('', handler);

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

// Undeclared: the binding's wrapper gives no reason, so calling it declares nothing.
export async function addViaUnreasoned(input: unknown) {
  return unreasoned(input);
}
