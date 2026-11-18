// Runs once when the Next.js server starts: a misconfigured app stops here instead of serving errors (AIV-P0-007).
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') (await import('./server/checkEnvOnStart')).checkEnvOnStart();
}
