import type { NextRequest } from 'next/server';
import { authConfigured, handlers } from '@/server/auth';

// Public: the Auth.js endpoints (sign-in redirect, OIDC callback, session). Auth.js checks state, PKCE and nonce on
// the callback; with no tenant configured the endpoints do not exist.
const notConfigured = () => new Response(null, { status: 404 });

export const GET = (request: NextRequest) => (authConfigured() ? handlers.GET(request) : notConfigured());
export const POST = (request: NextRequest) => (authConfigured() ? handlers.POST(request) : notConfigured());
