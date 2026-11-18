import { Button, Input, Label } from '@aivera/ui';

type SignInFormLabels = {
  title: string;
  email: string;
  passwordNote: string;
  signIn: string;
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
};

// shortcut: minimal form from the SignIn artboard copy; page polish, keep me signed in and forgot password are AIV-P1-002.
// No company single sign-on button until per-workspace federation ships (AIV-P1-057).
export function SignInForm({ action, next, error, labels }: SignInFormProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6">
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
        <Button type="submit" name="method" value="password" variant="primary">
          {labels.signIn}
        </Button>
        <p className="text-center text-meta text-text-2">{labels.or}</p>
        <Button type="submit" name="method" value="google">
          {labels.google}
        </Button>
      </form>
    </main>
  );
}
