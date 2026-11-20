'use server';

import { inActiveWorkspace } from '@/server/workspace';
import { platformOperator } from '@/server/operator';

// Declared: each calls a policy guard, directly or through a function of this file that does.
async function change(work: (ctx: unknown) => Promise<unknown>) {
  return inActiveWorkspace(work);
}
const viaHelper = () => change(async () => null);

export async function addClient(name: string) {
  return change((ctx) => getWorkspaces().addClient(ctx, name));
}

export const archiveClient = async () => viaHelper();

export async function openConsole() {
  await platformOperator();
}
