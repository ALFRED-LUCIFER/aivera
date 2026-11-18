import { Button } from '@aivera/ui';

// shortcut: placeholder until the marketing site ticket (J7) replaces it; copy here is not yet in @aivera/i18n.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6">
      <h1 className="font-display text-title tracking-tight">
        Hire on <mark className="rounded-tag bg-hl px-1.5 text-hl-text">evidence</mark>, not claims.
      </h1>
      <p className="text-text-2">Aivera workspace scaffold. Feature screens arrive with their tickets.</p>
      <div className="flex gap-3">
        <Button variant="primary">Create your workspace</Button>
        <Button>Sign in</Button>
      </div>
    </main>
  );
}
