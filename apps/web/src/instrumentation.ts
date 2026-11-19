// Runs once when the Next.js server starts: a misconfigured app stops here instead of serving errors (AIV-P0-007),
// then telemetry starts (AIV-P0-018; off without a connection string, as in local development and tests).
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const config = (await import('./server/checkEnvOnStart')).checkEnvOnStart();
  if (!config) return;
  // The modules' personal-data field names are redacted in logs and telemetry even where the allowlist would keep them.
  const { registerPersonalDataKeys } = await import('@aivera/observability');
  registerPersonalDataKeys((await import('@aivera/candidates')).PERSONAL_DATA_FIELDS);
  registerPersonalDataKeys((await import('@aivera/candidate-accounts')).PERSONAL_DATA_FIELDS);
  (await import('@aivera/observability/init')).initTelemetry('web', config.APPLICATIONINSIGHTS_CONNECTION_STRING);
}
