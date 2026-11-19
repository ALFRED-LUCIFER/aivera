'use client';

import type { ComponentProps } from 'react';
import { CandidateSignUp } from '@/features/candidate-account/components/CandidateSignUp.tsx';
import { useSignUpController } from '@/features/candidate-account/hooks/useSignUpController.ts';

type Props = Omit<ComponentProps<typeof CandidateSignUp>, 'action' | 'state' | 'pending'> & {
  /** Prefills "Full name" from the identity user's display name; never put in a URL. */
  fullName: string;
};

export function SignUpView({ fullName, ...props }: Props) {
  return <CandidateSignUp {...props} {...useSignUpController(fullName)} />;
}
