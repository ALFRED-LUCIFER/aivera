"""Who may call a task (ADR-015 point 2): internal ingress is network reach, not a policy (AGENTS.md 1.3).

Every task call carries the caller's managed-identity token for this service's app registration. The token's
signature, issuer (the workforce tenant), audience and expiry are checked, and its object id must be one of the app
identities allowed to call. Anything else is refused before the request body is validated or used.
"""

from collections.abc import Callable

import jwt
from fastapi import HTTPException, Request

Verifier = Callable[[str], str]
"""Checks a bearer token and returns the caller's object id, or raises jwt.PyJWTError or NotAllowed."""


class NotAllowed(Exception):
    """A valid token for an identity that is not allowed to call."""


def entra_verifier(
    tenant_id: str, audience: str, allowed: frozenset[str], jwks: jwt.PyJWKClient | None = None
) -> Verifier:
    keys = jwks or jwt.PyJWKClient(f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys")
    # A managed identity gets a v1 token unless the app registration asks for v2; both are signed by the tenant's keys.
    issuers = [f"https://sts.windows.net/{tenant_id}/", f"https://login.microsoftonline.com/{tenant_id}/v2.0"]
    # A v1 token names the audience as asked (api://<appId>); a v2 token names the bare app id.
    audiences = [audience, audience.removeprefix("api://")]

    def verify(token: str) -> str:
        claims = jwt.decode(
            token,
            keys.get_signing_key_from_jwt(token).key,
            algorithms=["RS256"],
            audience=audiences,
            issuer=issuers,
            options={"require": ["exp", "iat", "aud", "iss", "oid"]},
        )
        caller = str(claims["oid"])
        if caller not in allowed:
            raise NotAllowed
        return caller

    return verify


def require_caller(request: Request) -> str:
    """The dependency every task route declares (tests/test_auth.py checks each one does)."""
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, headers={"www-authenticate": "Bearer"})
    verify: Verifier = request.app.state.verify
    try:
        return verify(token)
    except jwt.PyJWKClientConnectionError:
        # The tenant's key set could not be fetched: retryable, not the caller's fault.
        raise HTTPException(503) from None
    except jwt.PyJWTError:
        raise HTTPException(401, headers={"www-authenticate": "Bearer"}) from None
    except NotAllowed:
        raise HTTPException(403) from None
