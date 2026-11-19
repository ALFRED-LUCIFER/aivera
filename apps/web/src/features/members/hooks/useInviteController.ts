import type { Role } from '@aivera/workspaces';
import { useActionState, useState } from 'react';
import { initialInviteState, JOB_SCOPED } from '../domain/members.ts';
import { inviteMember } from '../services/memberActions.ts';

/** The invite form: the posted action and its last result, and the chosen role, which decides the job picker. */
export function useInviteController() {
  const [state, action, pending] = useActionState(inviteMember, initialInviteState);
  const [role, setRole] = useState<Role>('hiring_owner');
  return { state, action, pending, role, onRoleChange: setRole, showPicker: JOB_SCOPED.includes(role) };
}
