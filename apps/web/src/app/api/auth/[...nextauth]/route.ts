import type { NextRequest } from 'next/server';
import { authConfigured, handlers } from '@/server/auth';
import { publicEntry } from '@/server/publicEntry';

// The Auth.js endpoints (sign-in redirect, OIDC callback, session). Auth.js checks state, PKCE and nonce on the
// callback; with no tenant configured the endpoints do not exist.
const notConfigured = () => new Response(null, { status: 404 });

export const GET = publicEntry(
  'Auth.js sign-in redirect and session; there is no session yet',
  (request: NextRequest) => (authConfigured() ? handlers.GET(request) : notConfigured()),
);
export const POST = publicEntry(
  'Auth.js OIDC callback and sign-out; Auth.js checks state, PKCE and nonce',
  (request: NextRequest) => (authConfigured() ? handlers.POST(request) : notConfigured()),
);
