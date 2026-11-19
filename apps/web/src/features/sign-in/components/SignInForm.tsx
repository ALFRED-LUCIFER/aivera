import { Button, Checkbox, Input, Label } from '@aivera/ui';

type SignInFormLabels = {
  title: string;
  panelTitle: string;
  panelBody: string;
  email: string;
  passwordNote: string;
  remember: string;
  signIn: string;
  forgotPassword: string;
  or: string;
  google: string;
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

// The SignIn artboard: the promise on the left, the form on the right (stacked under 1024px). No company single
// sign-on button until per-workspace federation ships (AIV-P1-057).
export function SignInForm({ action, next, error, labels, google }: SignInFormProps) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <aside className="flex flex-col justify-center gap-3 border-b border-border bg-surface-subtle px-6 py-10 lg:border-e lg:border-b-0 lg:px-16">
        <p className="font-display text-title tracking-tight text-text">{labels.panelTitle}</p>
        <p className="max-w-md text-body text-text-2">{labels.panelBody}</p>
      </aside>
      <main className="mx-auto flex w-full max-w-sm flex-col justify-center gap-6 px-6 py-10">
        <h1 className="font-display text-title tracking-tight">{labels.title}</h1>
        {error && (
          <p role="alert" className="text-body text-text">
            {error}
          </p>
        )}
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <Label htmlFor="sign-in-email">{labels.email}</Label>
          <Input id="sign-in-email" name="email" type="email" autoComplete="username" />
          <p className="text-meta text-text-2">{labels.passwordNote}</p>
          <Checkbox name="remember" label={labels.remember} />
          {/* First submit button, so Enter in the email field signs in. */}
          <Button type="submit" name="method" value="password" variant="primary">
            {labels.signIn}
          </Button>
          {/* Opens the tenant's user flow, whose own "Forgot password?" runs the reset; the email is not sent. */}
          <Button type="submit" name="method" value="reset" variant="ghost" className="self-start">
            {labels.forgotPassword}
          </Button>
          {google && (
            <>
              <p className="text-center text-meta text-text-2">{labels.or}</p>
              <Button type="submit" name="method" value="google">
                {labels.google}
              </Button>
            </>
          )}
        </form>
      </main>
    </div>
  );
}
