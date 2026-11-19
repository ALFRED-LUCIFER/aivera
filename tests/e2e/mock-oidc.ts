// A mocked OIDC provider standing in for the Entra External ID tenant in the end-to-end tests (AIV-P0-009). Node's
// standard library only. Its sign-in page plays the tenant's user flow: the test types the email, chooses whether the
// provider calls it verified, and continues. It checks PKCE and signs RS256 ID tokens like the real tenant.
// Usage: node mock-oidc.ts (listens on MOCK_OIDC_PORT, default 3299). Synthetic people only (AGENTS.md 1.1).
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const port = Number(process.env['MOCK_OIDC_PORT'] ?? 3299);
const issuer = `http://localhost:${port}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'mock-oidc-key';

type Grant = { clientId: string; nonce: string; challenge: string; email: string; verified: boolean; idp: string };
const grants = new Map<string, Grant>();

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function idToken(grant: Grant): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const claims = {
    iss: issuer,
    aud: grant.clientId,
    sub: `${grant.idp}|${grant.email}`,
    iat: now,
    exp: now + 600,
    nonce: grant.nonce,
    email: grant.email,
    // Like External ID: a verified email sends no email_verified claim at all; only the refusal case sends false.
    ...(grant.verified ? {} : { email_verified: false }),
    name: grant.email.split('@')[0],
    idp: grant.idp,
  };
  const body = `${header}.${b64(JSON.stringify(claims))}`;
  return `${body}.${b64(sign('sha256', Buffer.from(body), privateKey))}`;
}

const signInPage = (query: URLSearchParams) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mock tenant sign-in</title></head><body>
<h1>Mock tenant sign-in</h1>
<p>Hint: ${escape(query.get('domain_hint') ?? 'none')}</p>
<p>Prompt: ${escape(query.get('prompt') ?? 'none')}</p>
<form method="post" action="/authorize">
  ${['client_id', 'redirect_uri', 'state', 'nonce', 'code_challenge']
    .map((name) => `<input type="hidden" name="${name}" value="${escape(query.get(name) ?? '')}">`)
    .join('')}
  <label>Email <input name="email" type="email" value="${escape(query.get('login_hint') ?? '')}" required></label>
  <label><input name="verified" type="checkbox" checked> Email verified</label>
  <button type="submit">Continue</button>
  <button type="submit" name="idp" value="google">Sign in with Google</button>
</form></body></html>`;

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  let body = '';
  for await (const chunk of request) body += chunk;
  return new URLSearchParams(body);
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', issuer);
  if (url.pathname === '/.well-known/openid-configuration') {
    return json(response, 200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      // Auth.js requires one in the metadata, but reads the profile from the ID token, so it is never called.
      userinfo_endpoint: `${issuer}/userinfo`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    });
  }
  if (url.pathname === '/jwks') {
    return json(response, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] });
  }
  if (url.pathname === '/authorize' && request.method === 'GET') {
    if (url.searchParams.get('code_challenge_method') !== 'S256')
      return json(response, 400, { error: 'pkce_required' });
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return response.end(signInPage(url.searchParams));
  }
  if (url.pathname === '/authorize' && request.method === 'POST') {
    const form = await readForm(request);
    const code = randomUUID();
    grants.set(code, {
      clientId: form.get('client_id') ?? '',
      nonce: form.get('nonce') ?? '',
      challenge: form.get('code_challenge') ?? '',
      email: form.get('email') ?? '',
      verified: form.has('verified'),
      idp: form.get('idp') || 'email',
    });
    const back = new URL(form.get('redirect_uri') ?? '');
    back.searchParams.set('code', code);
    back.searchParams.set('state', form.get('state') ?? '');
    back.searchParams.set('iss', issuer);
    response.writeHead(302, { location: back.href });
    return response.end();
  }
  if (url.pathname === '/token' && request.method === 'POST') {
    const form = await readForm(request);
    const grant = grants.get(form.get('code') ?? '');
    grants.delete(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    if (!grant || b64(createHash('sha256').update(verifier).digest()) !== grant.challenge)
      return json(response, 400, { error: 'invalid_grant' });
    return json(response, 200, {
      access_token: randomUUID(),
      token_type: 'Bearer',
      expires_in: 600,
      id_token: idToken(grant),
    });
  }
  response.writeHead(404).end();
}).listen(port, () => console.error(`mock OIDC provider on ${issuer}`));
