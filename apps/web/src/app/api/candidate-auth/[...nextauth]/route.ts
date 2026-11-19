import type { NextRequest } from 'next/server';
import { candidateAuthConfigured, handlers } from '@/server/candidateAuth';

// Public: the candidate Auth.js endpoints (AIV-P0-011): sign-in redirect, OIDC callback, session. Auth.js checks state,
// PKCE and nonce on the callback; with no candidate settings the endpoints do not exist.
const notConfigured = () => new Response(null, { status: 404 });

export const GET = (request: NextRequest) => (candidateAuthConfigured() ? handlers.GET(request) : notConfigured());
export const POST = (request: NextRequest) => (candidateAuthConfigured() ? handlers.POST(request) : notConfigured());
