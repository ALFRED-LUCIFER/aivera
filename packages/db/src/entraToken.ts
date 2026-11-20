import { z } from 'zod';

// Azure Database for PostgreSQL takes a Microsoft Entra access token as the password (password auth is off on the
// dev server, ADR-008). Container Apps exposes the managed identity endpoint as IDENTITY_ENDPOINT + IDENTITY_HEADER.
const RESOURCE = 'https://ossrdbms-aad.database.windows.net';
const tokenResponse = z.object({ access_token: z.string().min(1), expires_on: z.coerce.number().int().positive() });

// Keyed by client id: the worker signs in as two identities, the app's and the outbox relay's (AIV-P0-015).
const cached = new Map<string, { token: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string>>();

/** A token for the user-assigned identity in AZURE_CLIENT_ID, reused until five minutes before it expires. */
export async function entraToken(env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<string> {
  const key = env['AZURE_CLIENT_ID'] ?? '';
  const hit = cached.get(key);
  if (hit && hit.expiresAt - 5 * 60_000 > now) return hit.token;
  // Connections opened together share one request; a failure clears it so the next connection retries.
  let request = inflight.get(key);
  if (!request) {
    request = fetchToken(env, key).finally(() => inflight.delete(key));
    inflight.set(key, request);
  }
  return request;
}

async function fetchToken(env: NodeJS.ProcessEnv, key: string): Promise<string> {
  const endpoint = env['IDENTITY_ENDPOINT'];
  const header = env['IDENTITY_HEADER'];
  if (!endpoint || !header) throw new Error('No password in the database URL and no managed identity endpoint.');
  const url = new URL(endpoint);
  url.searchParams.set('api-version', '2019-08-01');
  url.searchParams.set('resource', RESOURCE);
  if (env['AZURE_CLIENT_ID']) url.searchParams.set('client_id', env['AZURE_CLIENT_ID']);
  const response = await fetch(url, { headers: { 'X-IDENTITY-HEADER': header } });
  if (!response.ok) throw new Error(`Managed identity token request failed with ${response.status}.`);
  const parsed = tokenResponse.safeParse(await response.json());
  if (!parsed.success) throw new Error('Managed identity token response is malformed.');
  cached.set(key, { token: parsed.data.access_token, expiresAt: parsed.data.expires_on * 1000 });
  return parsed.data.access_token;
}
