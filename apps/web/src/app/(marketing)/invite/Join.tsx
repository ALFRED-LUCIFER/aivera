'use client';

import { JoinForm } from '@/features/members/components/AcceptInvitation.tsx';
import type { AcceptError } from '@/features/members/domain/accept.ts';
import { useAcceptController } from '@/features/members/hooks/useAcceptController.ts';

type Props = { token: string; label: string; errors: Record<AcceptError, string> };

export function Join({ token, label, errors }: Props) {
  const { state, action, pending } = useAcceptController();
  return (
    <JoinForm
      action={action}
      token={token}
      pending={pending}
      error={state.error && errors[state.error]}
      label={label}
    />
  );
}
