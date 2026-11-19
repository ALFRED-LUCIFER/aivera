import { Button } from '@aivera/ui';
import Link from 'next/link';
import { CANDIDATE_SIGN_UP } from '@/features/candidate-account/domain/signup.ts';

type Props = {
  /** The server action that starts the candidate sign-in at the tenant. */
  action: (form: FormData) => Promise<void>;
  /** Already sanitised; posted back and sanitised again by the action. */
  next: string;
  /** A message to show, already translated, or null. */
  error: string | null;
  labels: { title: string; signIn: string; or: string; google: string; noAccount: string; createAccount: string };
};

// The candidate sign-in inside the candidate shell, sized like the CSignUp form column (there is no separate artboard).
// "Continue with Google" sends no domain_hint, for the reason in authorizationParams' shortcut (signIn.ts),
// so Google is one click on the tenant's page. No email field: the email is typed on the tenant's page, so it never
// travels in a URL (AGENTS.md 1.2).
export function CandidateSignInForm({ action, next, error, labels }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-12">
      <h1 className="font-display text-title tracking-tight">{labels.title}</h1>
      {error && (
        <p role="alert" className="text-body text-text">
          {error}
        </p>
      )}
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="primary">
          {labels.signIn}
        </Button>
        <p className="text-center text-meta text-text-2">{labels.or}</p>
        <Button type="submit">{labels.google}</Button>
      </form>
      <p className="text-text-2">
        {labels.noAccount}{' '}
        <Link href={CANDIDATE_SIGN_UP} className="font-semibold text-text underline underline-offset-3">
          {labels.createAccount}
        </Link>
      </p>
    </div>
  );
}
