import { Button } from '@aivera/ui';
import type { ReactNode } from 'react';

type AcceptInvitationProps = {
  title: string;
  body: string;
  /** The page's one action: "Join", "Sign in or create an account", or "Sign out". */
  children?: ReactNode;
};

/** The invitation link's page: what the invitation is, or why it no longer works, and the next step. */
export function AcceptInvitation({ title, body, children }: AcceptInvitationProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-6 py-10">
      <h1 className="font-display text-title tracking-tight text-text">{title}</h1>
      <p className="text-body text-text-2">{body}</p>
      {children}
    </main>
  );
}

type JoinFormProps = {
  action: (form: FormData) => void;
  token: string;
  pending: boolean;
  /** The refusal to show, already translated, or null. */
  error: string | null;
  label: string;
};

/** "Join <workspace>": posts the link's token; the server takes everything else from the session. */
export function JoinForm({ action, token, pending, error, label }: JoinFormProps) {
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {error && (
        <p role="alert" className="text-body text-err-text">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending} className="self-start">
        {label}
      </Button>
    </form>
  );
}
