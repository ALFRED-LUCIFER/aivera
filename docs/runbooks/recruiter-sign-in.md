# Recruiter sign-in on Entra External ID (owner steps)

AIV-P0-009 built recruiter sign-in in code. The tenant itself is an owner action (CLAUDE.md). This runbook lists every step, in order. Decision: [ADR-009](../adr/ADR-009-identity-and-account-model.md).

## How it fits together

- **One OIDC provider in the app** (Auth.js provider id `entra`): the External ID tenant's **recruiter app registration**. The tenant's user flow offers email, Google and Microsoft. The app never sees a password.
- The sign-in page passes hints to the tenant: `login_hint` (the typed email), `domain_hint=google` for "Continue with Google", and `domain_hint=login.microsoftonline.com` for "Continue with Microsoft" (the custom OIDC provider below; External ID uses the issuer's host as the hint).
- The ID token's `iss` + `sub` become an `identity.sign_in_method`. The user is found by **verified** email (`email_verified: true` in the ID token). A token without `email_verified: true` never creates or joins a user ("Verify your email to continue."). See step 6.
- With no sign-in settings, the app still starts and `/api/health` and `/api/ready` still answer, so the deploy smoke test passes. `/sign-in` renders and says "Sign-in is not set up in this environment yet.". Every `/app` page redirects to `/sign-in` (fails closed). `pilot` and `prod` refuse to start without the settings.

## Settings

| App setting (`apps/web/src/server/env.ts`) | Value                                                                        | Where it lives                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| `AUTH_ENTRA_TENANT_SUBDOMAIN`              | The tenant's subdomain, e.g. `aiverarecruiters` (from `<sub>.ciamlogin.com`) | Plain Container App setting (not a secret)      |
| `AUTH_ENTRA_TENANT_ID`                     | The tenant's id (a GUID)                                                     | Plain Container App setting (not a secret)      |
| `AUTH_ENTRA_CLIENT_ID`                     | The recruiter app registration's application (client) id                     | Plain Container App setting (not a secret)      |
| `AUTH_ENTRA_CLIENT_SECRET`                 | The recruiter app registration's client secret value                         | Key Vault secret **`auth-entra-client-secret`** |
| `AUTH_SECRET`                              | 32+ random bytes that encrypt the session cookie: `openssl rand -base64 32`  | Key Vault secret **`auth-secret`**              |

The app derives the issuer `https://<tenant-id>.ciamlogin.com/<tenant-id>/v2.0` and reads the metadata from `https://<subdomain>.ciamlogin.com/<tenant-id>/v2.0/.well-known/openid-configuration`. The five settings are all or nothing: a partial set stops the app at start-up, naming what is missing. `AUTH_ENTRA_ISSUER` exists only for the mocked provider of the end-to-end tests and is refused outside `APP_ENV=local`.

## Owner steps

1. **Create the external tenant** (Entra admin center → Entra ID → Overview → Manage tenants → Create → External). Pick the data location your residency rules require, and record whether it can be UAE or Middle East; External ID's data location is chosen per tenant and is not an Azure region setting (AGENTS.md 1.10). Note the tenant id and subdomain.
2. **Register the recruiter app** (External tenant → App registrations → New registration, "Aivera recruiter app", accounts in this organizational directory only). Web platform redirect URIs, exactly:
   - `http://localhost:3001/api/auth/callback/entra` (local `next dev` on port 3001)
   - `https://ca-aivera-web-dev.greenground-7c8cb7a4.centralindia.azurecontainerapps.io/api/auth/callback/entra` (Azure dev)

   Then: Certificates & secrets → New client secret (note the expiry; record a reminder to rotate it). Token configuration → Add optional claim → ID token → `email`. API permissions: `openid`, `profile`, `email`, `offline_access` (delegated), and grant admin consent.

3. **Enable the local account methods** (External Identities → All identity providers → Built-in → Email one-time passcode: on, if you want it at all; see "Password or code" below).
4. **Google** (External Identities → All identity providers → Google). Create an OAuth client in Google Cloud (Web application) with the redirect URIs `https://<subdomain>.ciamlogin.com/<tenant-id>/federation/oauth2` and `https://<subdomain>.ciamlogin.com/<subdomain>.onmicrosoft.com/federation/oauth2`, and the JavaScript origin `https://<subdomain>.ciamlogin.com`. Paste its client id and secret into the tenant.
5. **Microsoft accounts: not built in, configured as a custom OIDC provider.** External ID's built-in providers are email (password or one-time passcode), Google, Facebook and Apple. Work accounts from another Entra tenant are offered through "Microsoft Entra ID federation", which is a custom OIDC provider for **one named tenant**; personal Microsoft accounts are not listed at all ([identity providers](https://learn.microsoft.com/en-us/entra/external-id/customers/concept-authentication-methods-customers), [custom OIDC](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-custom-oidc-federation-customers), both read on 18 Nov 2026). Steps:
   - In the Aivera workforce tenant, register "Aivera External ID federation" with supported account types **personal Microsoft accounts only**, redirect URIs as in step 4 (`…/federation/oauth2`), a client secret, and the optional ID token claim `email`.
   - In the external tenant: All identity providers → Custom → Add new → Open ID Connect. Display name "Microsoft". Well-known endpoint `https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration`. Issuer URI `https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0` (the fixed tenant of personal accounts). Client authentication `client_secret_post` (`client_secret_basic` is not supported). Scope `openid profile email`. Response type `code`. Claims mapping: Sub → `sub`, Name → `name`, Email → `email`; map Email_verified only if the provider sends it (personal accounts do not send `email_verified`; External ID then treats the email as unverified and may refuse sign-up, so test it).
   - **Work accounts (any company tenant):** External ID needs one fixed issuer per custom OIDC provider, and Microsoft's multi-tenant `organizations` endpoint issues tokens with a per-tenant issuer. So "any work account" is **not** possible as one provider; each company tenant would be its own provider, which is the per-workspace company SSO of AIV-P1-057. Until then, a recruiter with a work account signs in with that email and a password or code.
   - How sure: **high** that Microsoft accounts are not built in (the provider list is explicit). **Medium** on the personal-account OIDC setup and its `email_verified` behaviour (documented pieces, not tried end to end). **Medium** that work accounts from any tenant cannot be one provider (inferred from the fixed issuer requirement; not stated outright).
6. **Create the user flow** (External Identities → User flows → New user flow, "Recruiter sign-up and sign-in"). Identity providers: Email Accounts → **Email with password**; Google; Microsoft (the custom provider). Attributes: Display Name. Then User flow → Applications → add the recruiter app. Each app has exactly one user flow.
7. **Check the ID token before going further** (`https://jwt.ms` with a test user, synthetic data only): it must hold `iss`, `sub`, `email`, `name` and **`email_verified: true`**. If External ID does not emit `email_verified`, every sign-in is refused with "Verify your email to continue."; raise it with the lead instead of relaxing the check (AGENTS.md 2.7). A claims-mapping policy or custom claims provider may be needed.
8. **Wrong-password copy.** The password page is the tenant's. Set its error text to "That email and password do not match." under Company branding → Language customization (the default text already does not say whether the email exists). Tighten the password policy to at least 12 characters, per the SignUp copy, if the tenant allows it.
9. **Put the settings on Azure dev.** Write `auth-secret` and `auth-entra-client-secret` into Aivera's Key Vault (`kv-aivera-dev-…`). Add to `ca-aivera-web-dev` (and to `infra/modules/web.bicep` in a follow-up PR, so a Bicep apply keeps them): secrets `auth-secret` and `auth-entra-client-secret` as Key Vault references with the app identity, and env `AUTH_SECRET` (secretRef `auth-secret`), `AUTH_ENTRA_CLIENT_SECRET` (secretRef `auth-entra-client-secret`), `AUTH_ENTRA_TENANT_SUBDOMAIN`, `AUTH_ENTRA_TENANT_ID`, `AUTH_ENTRA_CLIENT_ID` (plain values). Redeploy; `/sign-in` → "Sign in" should reach the tenant.
10. **Local:** put the same five names in the repo-root `.env.local` (never committed) and run `pnpm --filter web exec next dev --port 3001`.

## Password or code: one per user flow

A user flow's email accounts offer **either** "Email with password" **or** "Email one-time passcode", not both ([user flow docs](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-user-flow-sign-up-sign-in-customers): "select the Email Accounts check box, and then select one of these options"). With "Email with password", a one-time passcode is used only for sign-up verification and password reset. So the ticket's "Email me a code" button cannot select one-time-code sign-in on the same user flow; today it opens the same tenant page as "Sign in". This needs a product decision (lead, then owner); it is not worked around in code.

## Testing without the tenant

`tests/e2e/mock-oidc.ts` is a mocked OIDC provider (PKCE, RS256 ID tokens, a sign-in page that plays the user flow). Playwright starts it and points the app at it with `AUTH_ENTRA_ISSUER=http://localhost:3299`. It needs a migrated PostgreSQL (`pnpm services:up` and `pnpm db:migrate`, or `E2E_DATABASE_URL`).
