import type { ReactNode } from 'react';

/** A full page that says why the app is not open or the page is not there: no access (403), no workspace yet, a 404 or a crash. */
export function AccessMessage({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <main id="content" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="font-display text-title tracking-tight">{title}</h1>
      {body && <p className="text-body text-text-2">{body}</p>}
      {children}
    </main>
  );
}
