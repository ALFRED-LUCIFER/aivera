import { useActionState } from 'react';
import { initialAcceptState } from '../domain/accept.ts';
import { acceptInvitation } from '../services/acceptInvitation.ts';

/** "Join": the posted action, its last refusal, and whether it is running. A success redirects to My desk. */
export function useAcceptController() {
  const [state, action, pending] = useActionState(acceptInvitation, initialAcceptState);
  return { state, action, pending };
}
