// Runs once when the Next.js server starts: a misconfigured app stops here instead of serving errors (AIV-P0-007),
// then telemetry starts (AIV-P0-018; off without a connection string, as in local development and tests).
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const config = (await import('./server/checkEnvOnStart')).checkEnvOnStart();
  if (config)
    (await import('@aivera/observability/init')).initTelemetry('web', config.APPLICATIONINSIGHTS_CONNECTION_STRING);
}
