import type { NextRequest } from 'next/server';
import { candidateAuthConfigured, handlers } from '@/server/candidateAuth';
import { publicEntry } from '@/server/publicEntry';

// The candidate Auth.js endpoints (AIV-P0-011): sign-in redirect, OIDC callback, session. Auth.js checks state, PKCE
// and nonce on the callback; with no candidate settings the endpoints do not exist.
const notConfigured = () => new Response(null, { status: 404 });

export const GET = publicEntry(
  'candidate Auth.js sign-in redirect and session; there is no session yet',
  (request: NextRequest) => (candidateAuthConfigured() ? handlers.GET(request) : notConfigured()),
);
export const POST = publicEntry(
  'candidate Auth.js OIDC callback and sign-out; Auth.js checks state, PKCE and nonce',
  (request: NextRequest) => (candidateAuthConfigured() ? handlers.POST(request) : notConfigured()),
);
