import { Button } from '@aivera/ui';

type Props = {
  /** The server action that starts the candidate sign-in at the tenant. */
  action: (form: FormData) => Promise<void>;
  /** Already sanitised; posted back and sanitised again by the action. */
  next: string;
  /** A message to show, already translated, or null. */
  error: string | null;
  labels: { title: string; signIn: string; or: string; google: string };
};

// shortcut: minimal candidate sign-in inside the candidate shell; the full CSignUp sign-up and sign-in pages are
// AIV-P3-007. "Continue with Google" sends no domain_hint, for the reason in authorizationParams' shortcut (signIn.ts),
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
    </div>
  );
}
