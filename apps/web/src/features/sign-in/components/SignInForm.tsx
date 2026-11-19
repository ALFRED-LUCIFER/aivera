import { Button, Checkbox, Input, Label } from '@aivera/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthPage } from './AuthPage.tsx';

type SignInFormLabels = {
  wordmark: string;
  headline: ReactNode;
  points: readonly string[];
  title: string;
  lead: string;
  email: string;
  passwordNote: string;
  remember: string;
  signIn: string;
  forgotPassword: string;
  or: string;
  google: string;
  newHere: string;
  createWorkspace: string;
};

type SignInFormProps = {
  /** The server action that starts the sign-in at the tenant. */
  action: (form: FormData) => Promise<void>;
  /** Already sanitised; posted back and sanitised again by the action. */
  next: string;
  /** A message to show, already translated, or null. */
  error: string | null;
  labels: SignInFormLabels;
  /** Whether "Continue with Google" is offered: only when the environment has the Google settings (AIV-P0-928). */
  google: boolean;
};

const RESET_FORM = 'sign-in-reset';

// The SignIn artboard (docs/01-design/artboards/SignIn.dc.html). Deviations: the password is typed on the tenant's
// hosted page, so a note replaces the password field; no company single sign-on button until AIV-P1-057; no
// "you@company.com" placeholder (no real domains, and messages ship in every page: ops-workspaces.spec.ts).
export function SignInForm({ action, next, error, labels: l, google }: SignInFormProps) {
  return (
    <AuthPage wordmark={l.wordmark} headline={l.headline} points={l.points} title={l.title} lead={l.lead}>
      {error && (
        <p role="alert" className="text-body text-text">
          {error}
        </p>
      )}
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-in-email">{l.email}</Label>
          <Input
            id="sign-in-email"
            name="email"
            type="email"
            autoComplete="username"
            className="min-h-11"
            aria-describedby="sign-in-password-note"
          />
          <p id="sign-in-password-note" className="text-meta text-text-2">
            {l.passwordNote}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Checkbox name="remember" label={l.remember} className="min-h-11" />
          {/* Owned by its own form below, so Enter in the email field still presses "Sign in". It opens the tenant's
              user flow, whose own "Forgot password?" runs the reset; the email is not sent. */}
          <button
            type="submit"
            form={RESET_FORM}
            name="method"
            value="reset"
            className="inline-flex min-h-11 cursor-pointer items-center text-body text-text underline decoration-1 underline-offset-3 hover:text-brand-hover"
          >
            {l.forgotPassword}
          </button>
        </div>
        <Button type="submit" name="method" value="password" variant="primary" size="large">
          {l.signIn}
        </Button>
        {google && (
          <>
            <p className="text-center text-meta text-text-2">{l.or}</p>
            <Button type="submit" name="method" value="google" size="large">
              {l.google}
            </Button>
          </>
        )}
      </form>
      <form id={RESET_FORM} action={action} hidden>
        <input type="hidden" name="next" value={next} />
      </form>
      <p className="text-body text-text-2">
        {l.newHere}{' '}
        <Link href="/signup" className="font-semibold text-text underline decoration-1 underline-offset-3">
          {l.createWorkspace}
        </Link>
      </p>
    </AuthPage>
  );
}
