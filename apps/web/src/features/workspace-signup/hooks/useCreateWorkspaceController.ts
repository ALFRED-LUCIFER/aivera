import { useActionState } from 'react';
import { initialCreateWorkspaceState } from '../domain/signup.ts';
import { createWorkspace } from '../services/createWorkspace.ts';

/**
 * The create-workspace form: the posted action, its last result (error and typed values) and whether it is running.
 * `company` pre-fills the field once, from the sign-in email's domain (AIV-P1-165).
 */
export function useCreateWorkspaceController(company = '') {
  const [state, action, pending] = useActionState(createWorkspace, {
    ...initialCreateWorkspaceState,
    values: { company, hiringFocus: '' },
  });
  return { state, action, pending };
}
