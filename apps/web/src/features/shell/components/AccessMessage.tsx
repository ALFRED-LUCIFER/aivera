/** A full page that says why the recruiter app is not open: no access (403), or no workspace yet. */
export function AccessMessage({ title, body }: { title: string; body: string }) {
  return (
    <main id="content" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="font-display text-title tracking-tight">{title}</h1>
      <p className="text-body text-text-2">{body}</p>
    </main>
  );
}
