# Candidate sign-in on Entra External ID

AIV-P0-011. Candidates sign in on the **same** dev External ID tenant as recruiters, through a **separate app registration, user flow and session** ([ADR-009](../adr/ADR-009-identity-and-account-model.md)). One person is one `identity.user` per verified email, so a recruiter who is also a candidate keeps one account, but the two sides never share a session. The recruiter setup is in [recruiter-sign-in.md](recruiter-sign-in.md).

Creating the app registration, the user flow and the Key Vault secret, and applying infrastructure, are **owner actions** (CLAUDE.md). The steps are below. Until they are done, candidate sign-in is off: `/candidates/sign-in` says "Sign-in is not set up in this environment yet.", every `/candidates/me` page redirects to `/candidates/sign-in` (fails closed), and the public candidate pages (`/candidates`, `/candidates/jobs`) keep working.

## What exists (dev)

The owner fills this table in while following the steps.

| Item                                     | Value                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant                                   | The recruiter tenant: `aiveradev`, id `88c795fc-1018-45f7-8904-75e1c2991b8f`                                                                                                        |
| Candidate app (client) id                | _not created yet_                                                                                                                                                                   |
| Client secret                            | Key Vault `kv-aivera-dev-3afs7i`, secret `entra-candidate-client-secret`, expires _date_                                                                                            |
| Session secret                           | The recruiter `auth-secret`, shared: each side's key is derived from it and that side's cookie name                                                                                 |
| User flow                                | `candidate-signup-signin`: **email with password** and **Google**, linked to the candidate app only                                                                                 |
| Redirect URIs (Auth.js `entra`)          | `http://localhost:3001/api/candidate-auth/callback/entra` and `https://ca-aivera-web-dev.greenground-7c8cb7a4.centralindia.azurecontainerapps.io/api/candidate-auth/callback/entra` |
| `entraCandidateClientId` in `main.bicep` | `''` (candidate sign-in off on Azure dev)                                                                                                                                           |

## How the app uses it

- A second Auth.js configuration (`apps/web/src/server/candidateAuth.ts`) with its own endpoints under `/api/candidate-auth`, its own session cookie `__Host-credalent-candidate` and its own sign-in page `/candidates/sign-in`. The recruiter configuration keeps `/api/auth`, `__Host-credalent-session` and `/sign-in`.
- The proxy (`apps/web/src/proxy.ts`) checks `/app` against the recruiter session only and `/candidates/me` against the candidate session only. Signing in on one side never sets the other side's cookie, and a cookie from one side does not decode on the other.
- `/candidates/sign-in` has "Sign in" and "Continue with Google". Both open the candidate user flow, where the email and password, or Google, are entered on the tenant's own page. There is no email field and **no `login_hint`**: the candidate's email never goes into a URL (AGENTS.md 1.2). There is no "Email me a code" (one email method per user flow) and no "Continue with Microsoft" (AIV-P1-058, #243).
- The ID token goes through the same `upsertUserFromIdToken` as recruiters. The candidate app has the same issuer but its own subject per user, so a verified email that already signs in as a recruiter joins that same user. There is no candidate user table; the candidate's own data comes with `@credalent/candidate-accounts` (AIV-P3-006).
- `identity` exposes nothing that tells recruiter-side code whether a user has a candidate session or account.
- `/candidates/signup` (AIV-P3-007): signed out, "Create free account" and "Continue with Google" start the same candidate user flow and return to `/candidates/signup`. Signed in, the page asks only for full name and kind of work (`@credalent/candidate-accounts` `signUp`), then goes to `/candidates/me`. `/candidates/me` sends a signed-in person who has not done that to `/candidates/signup`. "Sign out" in the candidate header clears only `__Host-credalent-candidate`.

## Settings

| App setting (`apps/web/src/server/env.ts`) | Dev value                   | Azure dev source (`infra/modules/web.bicep`)                      |
| ------------------------------------------ | --------------------------- | ----------------------------------------------------------------- |
| `AUTH_ENTRA_CANDIDATE_CLIENT_ID`           | the candidate app client id | Plain setting from the `entraCandidateClientId` parameter         |
| `AUTH_ENTRA_CANDIDATE_CLIENT_SECRET`       | (secret)                    | Key Vault reference `entra-candidate-client-secret`, app identity |

The two are all or nothing: one without the other stops the app at start-up, naming only what is missing. They also need the recruiter settings (the tenant, `AUTH_SECRET`), which they share. While `entraCandidateClientId` is empty, `web.bicep` leaves both settings and the Key Vault reference out, so an apply never fails on a secret that does not exist yet.

## Owner steps

### 1. Register the candidate app

In the Microsoft Entra admin center, switch to the `aiveradev` external tenant.

1. **App registrations → New registration.** Name `aivera-candidates-dev`. Supported account types: **Accounts in this organizational directory only**. Redirect URI: platform **Web**, `http://localhost:3001/api/candidate-auth/callback/entra`. Register.
2. **Authentication → Add URI:** `https://ca-aivera-web-dev.greenground-7c8cb7a4.centralindia.azurecontainerapps.io/api/candidate-auth/callback/entra`. Leave implicit grant off (the app uses the authorization code flow with PKCE). Save.
3. **API permissions:** match the recruiter app: Microsoft Graph delegated `openid`, `profile` and `email`, then **Grant admin consent**.
4. Copy the **Application (client) id** into "What exists" above.

### 2. Create the client secret and store it in Key Vault

1. **Certificates & secrets → New client secret**, description `aivera-web-dev`, the longest expiry the tenant offers (24 months). Copy the **Value** once; it is not shown again.
2. Store it without leaving it in shell history or a tracked file:

   ```sh
   read -rs CANDIDATE_SECRET   # paste the value, press Enter
   az keyvault secret set --vault-name kv-aivera-dev-3afs7i --name entra-candidate-client-secret \
     --value "$CANDIDATE_SECRET" --expires <expiry as YYYY-MM-DDT00:00:00Z> --output none
   unset CANDIDATE_SECRET
   ```

3. Record the expiry date in "What exists" above.

### 3. Create the candidate user flow

1. **External Identities → User flows → New user flow.** Name `candidate-signup-signin`.
2. Identity providers: **Email with password** (not one-time passcode) and **Google** (the tenant's existing Google provider). Email accounts with password verify the email with a one-time code at sign-up, so no account exists before the email is verified.
3. User attributes: **Display Name**. Create.
4. Open the new flow → **Applications → Add application** → `aivera-candidates-dev`. Link it to the candidate app only; the recruiter app keeps `recruiter-signup-signin-v2` (replaced `recruiter-signup-signin` on 19 Nov 2026).

### 4. Give the web app the candidate settings

1. Open a PR that sets the default of `entraCandidateClientId` in `infra/main.bicep` to the client id from step 1 (it is not a secret). Keeping it in the template means a later apply without the parameter does not turn candidate sign-in off again.
2. After it merges, apply `infra/main.bicep` as in [infra/README.md](../../infra/README.md) (what-if first). The web app then gets `AUTH_ENTRA_CANDIDATE_CLIENT_ID` and the Key Vault reference for `AUTH_ENTRA_CANDIDATE_CLIENT_SECRET`; the app identity already has Key Vault Secrets User.

### 5. Run the owner checks and record them

Run these on Azure dev with synthetic `@example.com` addresses only, and fill in the table with the date.

| Check                                                                                                                                        | Result (date) |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| "Sign in" on `/candidates/sign-in`, sign up with email and password: lands on `/candidates/signup`, then `/candidates/me` after the profile  |               |
| "Continue with Google": lands on `/candidates/me`                                                                                            |               |
| The request to the tenant has no `login_hint` and no email (browser network tab)                                                             |               |
| Signed in as a candidate only, `/app` redirects to `/sign-in`; no `__Host-credalent-session` cookie                                          |               |
| Signed in as a recruiter only, `/candidates/me` redirects to `/candidates/sign-in`                                                           |               |
| A recruiter's email signing in as a candidate: still one row in `identity.user` for that email                                               |               |
| Sign-up with an 8-character password on the tenant's page is refused with the tenant's own message. Minimum length the tenant enforces: \_\_ |               |
| Sign-up without completing email verification: no account is created and the app is never reached                                            |               |
| AIV-P3-007: sign-up with an email without "@" is refused with the tenant's own message                                                       |               |
| AIV-P3-007: sign-up with an email that already has an account is refused, and the message does not name the recruiter app                    |               |
| AIV-P3-007: a new sign-up returns to `/candidates/signup` asking only for full name and kind of work, then lands on `/candidates/me`         |               |

## Local

Add the two settings to the repo-root `.env.local` (never committed), next to the recruiter ones. Read the client secret from Key Vault yourself; never paste it into a tracked file. Then run `pnpm --filter web exec next dev --port 3001`, the port registered as a redirect URI.

## Testing without the tenant

The end-to-end tests point both configurations at the mocked provider (`tests/e2e/mock-oidc.ts`) with a separate candidate client id. A second app server with recruiter sign-in but no candidate settings runs the unconfigured checks (`tests/e2e/src/candidate-sign-in.unconfigured.spec.ts`).
