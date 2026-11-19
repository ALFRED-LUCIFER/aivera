# Recruiter sign-in on Entra External ID

AIV-P0-009, AIV-P1-002. Recruiters sign in on the dev External ID tenant through its recruiter app registration ([ADR-009](../adr/ADR-009-identity-and-account-model.md)). Changing tenant settings, Key Vault and applying infrastructure are owner actions (CLAUDE.md).

## What exists (dev)

| Item                            | Value                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant subdomain                | `aiveradev` (`https://aiveradev.ciamlogin.com`)                                                                                                                 |
| Tenant id                       | `88c795fc-1018-45f7-8904-75e1c2991b8f`                                                                                                                          |
| Recruiter app (client) id       | `463fb57b-570d-4384-b914-1078df012bd8`                                                                                                                          |
| Client secret                   | Key Vault `kv-aivera-dev-3afs7i`, secret `entra-recruiter-client-secret`, expires **2027-11-18** (rotate before then)                                           |
| Session secret                  | Key Vault `kv-aivera-dev-3afs7i`, secret `auth-secret`                                                                                                          |
| User flow                       | `recruiter-signup-signin`: **email with password** and **Google**, linked to the recruiter app                                                                  |
| Redirect URIs (Auth.js `entra`) | `http://localhost:3001/api/auth/callback/entra` and `https://ca-aivera-web-dev.greenground-7c8cb7a4.centralindia.azurecontainerapps.io/api/auth/callback/entra` |

The tenant's metadata, `https://aiveradev.ciamlogin.com/88c795fc-1018-45f7-8904-75e1c2991b8f/v2.0/.well-known/openid-configuration`, names the issuer `https://88c795fc-1018-45f7-8904-75e1c2991b8f.ciamlogin.com/88c795fc-1018-45f7-8904-75e1c2991b8f/v2.0`: the tenant-id host, not the subdomain. The app expects exactly that issuer in every ID token and reads the metadata from the subdomain host (checked 18 Nov 2026).

## How the app uses it

- **One OIDC provider** (Auth.js id `entra`). Every sign-in method is chosen on the tenant's pages, so the app never sees a password. The sign-in page passes the typed email as `login_hint`, and "Continue with Google" opens the same tenant page, where Google is one click: no `domain_hint` is sent, because on this tenant `google` is refused (AADSTS90023) and `google.com` skips sign-up for a first-time user (AADSTS50020).
- **Sign-up** starts at `/signup` (the home page's "Create your workspace", AIV-P1-059): it opens the same user flow with `prompt=create`, which External ID uses to show its sign-up page, and no `login_hint`; a tenant that ignores the prompt shows the sign-in page, which offers "Sign up". It returns to `/app`, where a new user sees the no-workspace page. Signed in, `/signup` goes straight to `/app`; with no tenant configured, to the sign-in page's "not set up" message.
- The page offers only what the user flow offers: **email with password** and **Google**. There is no "Email me a code" (one email method per user flow, below) and no "Continue with Microsoft" (it cannot be added to the user flow; personal Microsoft accounts are AIV-P1-058 (#243)).
- The ID token's `iss` + `sub` become an `identity.sign_in_method`, and the user is found by **verified** email (ADR-009 point 4, amended 18 Nov 2026):
  - `email_verified: true` counts as verified.
  - So does a token from our tenant's issuer with no `email_verified` claim: the tenant's metadata lists no such claim, but the tenant verifies every email before it creates an account.
  - An explicit `false`, or any other issuer without `true`, never creates or joins a user ("Verify your email to continue.").
- The session cookie `__Host-aivera-session` holds only the identity user id and the "Keep me signed in" choice, encrypted with `AUTH_SECRET`.
- **Session length** (AIV-P1-002): unticked, the session ends after 8 hours with no request (each request through the proxy re-issues the token and restarts its clock); ticked, it ends 30 days after sign-in however often it is used. The choice travels to the tenant and back in a 15-minute HTTP-only cookie `__Host-aivera-remember` (never in a URL), and is then held in the session token. The cookie itself lives 30 days either way; an expired token inside it is refused and dropped. The lengths are platform values until workspace settings ship (AIV-P1-051, #201).
- **Forgot password?** (AIV-P1-002) opens the same user flow with no `login_hint`, so the typed email never travels in a URL. The tenant's page has its own "Forgot password?" link, which runs self-service password reset; the app shows no reset message of its own.
- **Return-to** (`?next=`) keeps only same-origin paths under `/app`; anything else lands on My desk.
- **Sign out** in the sidebar calls Auth.js `signOut`: it clears `__Host-aivera-session` and lands on `/sign-in`. The tenant's own session is not ended (RP-initiated logout would need a post-logout URI registered on the app, an owner action), so every sign-in and "Forgot password?" sends `prompt=login`: the tenant asks for the password again, so with email and password the next person at a shared computer cannot land in the previous recruiter's account. Whether the tenant passes `prompt=login` on to Google is an owner check below: if it does not, a Google session still open in the browser could sign the next person in. The cost is one extra step when the tenant session is still alive, which is rare with 8-hour and 30-day sessions. Sign-up (`prompt=create`) opens the tenant's sign-up page, not an account, and clears any leftover "Keep me signed in" choice.
- With no sign-in settings the app still starts, `/api/health` and `/api/ready` still answer, and the deploy smoke test passes; `/sign-in` says "Sign-in is not set up in this environment yet." and every `/app` page redirects to `/sign-in` (fails closed). `pilot` and `prod` refuse to start without the settings.

## Settings

| App setting (`apps/web/src/server/env.ts`) | Dev value                              | Azure dev source (`infra/modules/web.bicep`)                      |
| ------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------- |
| `AUTH_ENTRA_TENANT_SUBDOMAIN`              | `aiveradev`                            | Plain setting                                                     |
| `AUTH_ENTRA_TENANT_ID`                     | `88c795fc-1018-45f7-8904-75e1c2991b8f` | Plain setting                                                     |
| `AUTH_ENTRA_CLIENT_ID`                     | `463fb57b-570d-4384-b914-1078df012bd8` | Plain setting                                                     |
| `AUTH_ENTRA_CLIENT_SECRET`                 | (secret)                               | Key Vault reference `entra-recruiter-client-secret`, app identity |
| `AUTH_SECRET`                              | (secret: `openssl rand -base64 32`)    | Key Vault reference `auth-secret`, app identity                   |

The five are all or nothing: a partial set stops the app at start-up, naming only what is missing. `AUTH_ENTRA_ISSUER` exists only for the mocked provider of the end-to-end tests and is refused outside `APP_ENV=local`.

Azure dev also sets `AUTH_URL` to the app's public origin (built from the environment's default domain), read by Auth.js directly: the container listens on `0.0.0.0:3000`, and without it sign-in redirects go to `https://0.0.0.0:3000`. Locally it is not needed.

## Owner steps still open

1. **Apply `infra/main.bicep`.** It gives the web app the five settings and `AUTH_URL`; the app identity already has Key Vault Secrets User. `deploy-dev.yml` updates only the image, so the settings arrive with the apply. Both Key Vault secrets exist.
2. **Wrong-password copy.** The password page belongs to the tenant. Set its error text to "That email and password do not match." under Company branding → Language customization; the default already does not say whether the email exists. Raise the password minimum to 12 characters, per the SignUp copy, if the tenant allows it.
3. **Run the owner checks below** and record the results.

## Owner checks (AIV-P1-002)

The password page, its lockout and password reset belong to the tenant, so they are checked by hand on the dev tenant's `recruiter-signup-signin` user flow, not by the app's tests. Record each result with its date.

| Check                                                                                                                                                         | Result and date |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| A wrong password for `nadia@example.com` shows "That email and password do not match." (or the tenant's equivalent) and does not say whether the email exists | Not yet run     |
| Repeated wrong passwords are slowed by the tenant's own lockout (smart lockout), not by the app                                                               | Not yet run     |
| "Forgot password?" on the tenant's page sends a reset code to the email and lets the owner set a new password                                                 | Not yet run     |
| "Forgot password?" on Aivera's page opens the tenant's page with an empty email field and no `login_hint` in the URL                                          | Not yet run     |
| After Sign out, "Continue with Google" on a shared browser makes Google ask to choose or confirm the account (the tenant passes `prompt=login` on)            | Not yet run     |

## Microsoft accounts

**Microsoft accounts are not built-in providers in External ID.** The built-in providers are email (password or one-time passcode), Google, Facebook and Apple ([identity providers](https://learn.microsoft.com/en-us/entra/external-id/customers/concept-authentication-methods-customers), read 18 Nov 2026). The owner confirmed in the portal that `recruiter-signup-signin` offers only Google to add. "Continue with Microsoft" is therefore not shown.

- **Personal accounts:** AIV-P1-058 (#243) covers them, as a [custom OIDC provider](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-custom-oidc-federation-customers) on the fixed consumers issuer `https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0`. Medium confidence that this setup works.
- **Work accounts from any company tenant:** these cannot be one provider. A custom provider needs one fixed issuer, and the multi-tenant endpoint issues per-tenant issuers. Each company tenant is its own federation, which is the company SSO of AIV-P1-057. Medium confidence: this is inferred from the fixed-issuer rule.

## Password or code: one per user flow

A user flow's email accounts offer **either** "Email with password" **or** "Email one-time passcode", not both. The [user flow docs](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-user-flow-sign-up-sign-in-customers) say "select the Email Accounts check box, and then select one of these options", and each app has exactly one user flow. The owner chose email with password. A one-time passcode therefore only verifies the email at sign-up and resets a password, and the sign-in page has no "Email me a code" button.

## Local

Put the five settings in the repo-root `.env.local` (never committed). Read the client secret from Key Vault yourself; never paste it into a file that is tracked. Then run `pnpm --filter web exec next dev --port 3001`, the port registered as a redirect URI.

## Testing without the tenant

`tests/e2e/mock-oidc.ts` is a mocked OIDC provider: PKCE, RS256 ID tokens, and a sign-in page that plays the user flow. Playwright starts it and points the app at it with `AUTH_ENTRA_ISSUER=http://localhost:3299`. It needs a migrated PostgreSQL: `pnpm services:up` and `pnpm db:migrate`, or `E2E_DATABASE_URL`.
