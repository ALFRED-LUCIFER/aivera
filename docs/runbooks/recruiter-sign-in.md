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
| User flow                       | `recruiter-signup-signin-v2`: **email with password** (its Google option is unused: AIV-P0-928), linked to the recruiter app                                    |
| Redirect URIs (Auth.js `entra`) | `http://localhost:3001/api/auth/callback/entra` and `https://ca-aivera-web-dev.greenground-7c8cb7a4.centralindia.azurecontainerapps.io/api/auth/callback/entra` |

The tenant's metadata, `https://aiveradev.ciamlogin.com/88c795fc-1018-45f7-8904-75e1c2991b8f/v2.0/.well-known/openid-configuration`, names the issuer `https://88c795fc-1018-45f7-8904-75e1c2991b8f.ciamlogin.com/88c795fc-1018-45f7-8904-75e1c2991b8f/v2.0`: the tenant-id host, not the subdomain. The app expects exactly that issuer in every ID token and reads the metadata from the subdomain host (checked 18 Nov 2026).

## How the app uses it

- **Two OIDC providers.** Email with password uses the tenant (Auth.js id `entra`): the password is typed on the tenant's page, so the app never sees it, and the sign-in page passes the typed email as `login_hint`. **"Continue with Google" goes straight to Google** (Auth.js id `google`, AIV-P0-928) with `prompt=select_account`, so Google always asks which account. The tenant cannot create Google users (AADSTS50132) and refuses `domain_hint` for one click (`google`: AADSTS90023; `google.com`: AADSTS50020 for a first-time user), ADR-009. Without the Google settings below, the button is not shown.
- **Sign-up** starts at `/signup` (the home page's "Create your workspace", AIV-P1-059): it opens the same user flow with `prompt=create`, which External ID uses to show its sign-up page, and no `login_hint`; a tenant that ignores the prompt shows the sign-in page, which offers "Sign up". It returns to `/app`, where a new user sees the no-workspace page. Signed in, `/signup` goes straight to `/app`; with no tenant configured, to the sign-in page's "not set up" message.
- The page offers **email with password** (the user flow) and **Google** (direct, when configured). There is no "Email me a code" (one email method per user flow, below) and no "Continue with Microsoft" (personal Microsoft accounts are AIV-P1-058 (#243)).
- The ID token's `iss` + `sub` become an `identity.sign_in_method`, and the user is found by **verified** email (ADR-009 point 4, amended 18 Nov 2026):
  - `email_verified: true` counts as verified.
  - So does a token from our tenant's issuer with no `email_verified` claim: the tenant's metadata lists no such claim, but the tenant verifies every email before it creates an account.
  - An explicit `false`, or any other issuer without `true`, never creates or joins a user ("Verify your email to continue.").
- The session cookie `__Host-credalent-session` holds only the identity user id, the "Keep me signed in" choice, the sign-in time and the operator flag, encrypted with `AUTH_SECRET`.
- **Session length** (AIV-P1-002, AIV-P2-060): unticked, the session ends 8 hours after sign-in; ticked, 30 days after sign-in; either way however often it is used (the token keeps its sign-in time, `signedInAt`, through every re-issue, and a token without one is dropped). A platform operator's session also ends after one hour with no request (ADR-012): the token carries an `operator` flag set at sign-in from `PLATFORM_OPERATOR_EMAILS`, which sets the length only; `/ops` access is still checked against the list on every request, and a session without the flag (signed in before its person was listed) is sent to sign in again. The pilot and production also require `AUTH_URL` to be https. The choice travels to the tenant and back in a 15-minute HTTP-only cookie `__Host-credalent-remember` (never in a URL), and is then held in the session token. The cookie itself lives 30 days either way; an expired token inside it is refused and dropped. The lengths are platform values until workspace settings ship (AIV-P1-051, #201).
- **Forgot password?** (AIV-P1-002) opens the same user flow with no `login_hint`, so the typed email never travels in a URL. The tenant's page has its own "Forgot password?" link, which runs self-service password reset; the app shows no reset message of its own.
- **A failed sign-in** (`/sign-in?error=…`, "Sign-in did not finish") logs `area: auth` with the Auth.js `code` and, when Auth.js wrapped another error, `credalent.auth.cause` (its class name) and `credalent.auth.cause_code` (its code) (AIV-P0-930); never its message. Production minifies library class names, so for token-endpoint errors read `cause_code`; `cause` is often missing. `code: InvalidCheck` means the browser's sign-in cookies did not match (often two sign-ins started in one browser); `CallbackRouteError` with `cause_code: OAUTH_RESPONSE_BODY_ERROR` is the tenant's token endpoint refusing the code; `AccessDenied` with a database `cause_code` is the identity upsert failing. An unverified email is not an error: it lands on `/sign-in?error=unverified_email` with no auth log line.
- **Return-to** (`?next=`) keeps only same-origin paths under `/app`; anything else lands on My desk.
- **Sign out** in the sidebar calls Auth.js `signOut`: it clears `__Host-credalent-session` and lands on `/sign-in`. The tenant's own session is not ended (RP-initiated logout would need a post-logout URI registered on the app, an owner action), so every tenant sign-in and "Forgot password?" sends `prompt=login`: the tenant asks for the password again, so with email and password the next person at a shared computer cannot land in the previous recruiter's account. Google gets `prompt=select_account`: Google always shows its account chooser, but Google has no way to force a password, so a Google session still open in the browser lets the next person pick the previous recruiter's listed account. On a shared computer, sign out of Google too. The cost is one extra step when the tenant session is still alive, which is rare with 8-hour and 30-day sessions. Sign-up (`prompt=create`) opens the tenant's sign-up page, not an account, and clears any leftover "Keep me signed in" choice.
- With no sign-in settings the app still starts, `/api/health` and `/api/ready` still answer, and the deploy smoke test passes; `/sign-in` says "Sign-in is not set up in this environment yet." and every `/app` page redirects to `/sign-in` (fails closed). `pilot` and `prod` refuse to start without the settings.

## Settings

| App setting (`apps/web/src/server/env.ts`) | Dev value                              | Azure dev source (`infra/modules/web.bicep`)                      |
| ------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------- |
| `AUTH_ENTRA_TENANT_SUBDOMAIN`              | `aiveradev`                            | Plain setting                                                     |
| `AUTH_ENTRA_TENANT_ID`                     | `88c795fc-1018-45f7-8904-75e1c2991b8f` | Plain setting                                                     |
| `AUTH_ENTRA_CLIENT_ID`                     | `463fb57b-570d-4384-b914-1078df012bd8` | Plain setting                                                     |
| `AUTH_ENTRA_CLIENT_SECRET`                 | (secret)                               | Key Vault reference `entra-recruiter-client-secret`, app identity |
| `AUTH_SECRET`                              | (secret: `openssl rand -base64 32`)    | Key Vault reference `auth-secret`, app identity                   |
| `AUTH_GOOGLE_CLIENT_ID`                    | (Google OAuth client id)               | Plain setting, bicep param `googleClientId`                       |
| `AUTH_GOOGLE_CLIENT_SECRET`                | (secret)                               | Key Vault reference `google-client-secret`, app identity          |

The two Google settings are both or neither. The first five are all or nothing: a partial set stops the app at start-up, naming only what is missing. `AUTH_ENTRA_ISSUER` and `AUTH_GOOGLE_ISSUER` exist only for the mocked providers of the end-to-end tests and are refused outside `APP_ENV=local`.

Azure dev also sets `AUTH_URL` to the app's public origin (built from the environment's default domain), read by Auth.js directly: the container listens on `0.0.0.0:3000`, and without it sign-in redirects go to `https://0.0.0.0:3000`. The pilot and production refuse to start without it (`apps/web/src/server/env.ts`, AIV-P2-060), because Auth.js otherwise trusts the request host. Locally it is not needed.

## Owner steps still open

0. **Google OAuth client (AIV-P0-928).** In Google Cloud console → APIs & Services → Credentials, create an OAuth client ID (type Web application) or reuse the tenant's one, and add the authorised redirect URIs `https://ca-aivera-web-dev.greenground-7c8cb7a4.centralindia.azurecontainerapps.io/api/auth/callback/google` and, for local work, `http://localhost:3000/api/auth/callback/google`. Write its secret to Key Vault as `google-client-secret`, then apply `infra/main.bicep` with `googleClientId` set. The OAuth consent screen must be published (or list the testers' Google accounts) for anyone outside the project to sign in.

1. **Apply `infra/main.bicep`.** It gives the web app the five settings and `AUTH_URL`; the app identity already has Key Vault Secrets User. `deploy-dev.yml` updates only the image, so the settings arrive with the apply. Both Key Vault secrets exist.
2. **Wrong-password copy.** The password page belongs to the tenant. Set its error text to "That email and password do not match." under Company branding → Language customization; the default already does not say whether the email exists. Raise the password minimum to 12 characters, per the SignUp copy, if the tenant allows it.
3. **Run the owner checks below** and record the results.

## Owner checks (AIV-P1-002)

The password page, its lockout and password reset belong to the tenant, so they are checked by hand on the dev tenant's `recruiter-signup-signin-v2` user flow, not by the app's tests. Record each result with its date.

| Check                                                                                                                                                         | Result and date                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A wrong password for `nadia@example.com` shows "That email and password do not match." (or the tenant's equivalent) and does not say whether the email exists | **Failed, 24 Nov 2026** (run by an agent from the dev sign-in page). The dev tenant has no account for `nadia@example.com`, and its email step answers "We couldn't find an account with this email address.": the page says whether an email exists. The password step, and so the wrong-password text, was not reached. Open: see below |
| Repeated wrong passwords are slowed by the tenant's own lockout (smart lockout), not by the app                                                               | Not yet run                                                                                                                                                                                                                                                                                                                               |
| "Forgot password?" on the tenant's page sends a reset code to the email and lets the owner set a new password                                                 | Not yet run                                                                                                                                                                                                                                                                                                                               |
| "Forgot password?" on Credalent's page opens the tenant's page with an empty email field and no `login_hint` in the URL                                       | **Passed, 24 Nov 2026** (run by an agent on dev): the tenant's page opened with an empty email field and `prompt=login`; the URL held no `login_hint` and no email                                                                                                                                                                        |
| After Sign out, "Continue with Google" on a shared browser shows Google's account chooser (`prompt=select_account`, sent straight to Google)                  | Not yet run                                                                                                                                                                                                                                                                                                                               |

**Open after the 24 Nov 2026 run (owner):**

- The user flow's email step says whether an account exists. Decide whether that is acceptable for the pilot, or change the tenant's sign-in page so it does not; AIV-P0-009 (#41) and AIV-P1-002 (#66) both ask for a page that "does not say whether the email exists".
- Create a synthetic recruiter account on the dev tenant (the tickets name `nadia@example.com`, which cannot receive a verification code; use an address the owner can read) and rerun the wrong-password, lockout and reset checks with it.
- The Google check waits for owner step 0: the dev sign-in page shows no "Continue with Google" yet. The tenant's own page does show "Sign in with Google".

## Microsoft accounts

**Microsoft accounts are not built-in providers in External ID.** The built-in providers are email (password or one-time passcode), Google, Facebook and Apple ([identity providers](https://learn.microsoft.com/en-us/entra/external-id/customers/concept-authentication-methods-customers), read 18 Nov 2026). The owner confirmed in the portal that the recruiter user flow offers only Google to add. "Continue with Microsoft" is therefore not shown.

- **Personal accounts:** AIV-P1-058 (#243) covers them, as a [custom OIDC provider](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-custom-oidc-federation-customers) on the fixed consumers issuer `https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0`. Medium confidence that this setup works.
- **Work accounts from any company tenant:** these cannot be one provider. A custom provider needs one fixed issuer, and the multi-tenant endpoint issues per-tenant issuers. Each company tenant is its own federation, which is the company SSO of AIV-P1-057. Medium confidence: this is inferred from the fixed-issuer rule.

## Password or code: one per user flow

A user flow's email accounts offer **either** "Email with password" **or** "Email one-time passcode", not both. The [user flow docs](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-user-flow-sign-up-sign-in-customers) say "select the Email Accounts check box, and then select one of these options", and each app has exactly one user flow. The owner chose email with password. A one-time passcode therefore only verifies the email at sign-up and resets a password, and the sign-in page has no "Email me a code" button.

## Local

Put the five settings in the repo-root `.env.local` (never committed). Read the client secret from Key Vault yourself; never paste it into a file that is tracked. Then run `pnpm --filter web exec next dev --port 3001`, the port registered as a redirect URI.

## Testing without the tenant

`tests/e2e/mock-oidc.ts` is a mocked OIDC provider: PKCE, RS256 ID tokens, and a sign-in page that plays the user flow. Playwright starts it and points the app at it with `AUTH_ENTRA_ISSUER=http://localhost:3299`. It needs a migrated PostgreSQL: `pnpm services:up` and `pnpm db:migrate`, or `E2E_DATABASE_URL`.
