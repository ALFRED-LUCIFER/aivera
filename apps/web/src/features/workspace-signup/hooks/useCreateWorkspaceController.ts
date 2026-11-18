import { useActionState } from 'react';
import { initialCreateWorkspaceState } from '../domain/signup.ts';
import { createWorkspace } from '../services/createWorkspace.ts';

/** The create-workspace form: the posted action, its last result (error and typed values) and whether it is running. */
export function useCreateWorkspaceController() {
  const [state, action, pending] = useActionState(createWorkspace, initialCreateWorkspaceState);
  return { state, action, pending };
}
