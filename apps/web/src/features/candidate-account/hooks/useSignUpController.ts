import { useActionState } from 'react';
import { initialSignUpState } from '../domain/signup.ts';
import { completeSignUp } from '../services/completeSignUp.ts';

/** The sign-up form: the posted action, its last result (field errors and typed values) and whether it is running. */
export function useSignUpController(fullName: string) {
  const [state, action, pending] = useActionState(completeSignUp, initialSignUpState(fullName));
  return { state, action, pending };
}
