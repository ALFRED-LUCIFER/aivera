# Recruiter sign-in on Entra External ID

AIV-P0-009. Recruiters sign in on the dev External ID tenant through its recruiter app registration ([ADR-009](../adr/ADR-009-identity-and-account-model.md)). Changing tenant settings, Key Vault and applying infrastructure are owner actions (CLAUDE.md).

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

- **One OIDC provider** (Auth.js id `entra`). Every sign-in method is chosen on the tenant's pages, so the app never sees a password. The sign-in page passes the typed email as `login_hint`, and "Continue with Google" sends `domain_hint=google.com` so the tenant goes straight to Google (plain `google` is refused with AADSTS90023).
- The page offers only what the user flow offers: **email with password** and **Google**. There is no "Email me a code" (one email method per user flow, below) and no "Continue with Microsoft" (it cannot be added to the user flow; personal Microsoft accounts are AIV-P1-058 (#243)).
- The ID token's `iss` + `sub` become an `identity.sign_in_method`, and the user is found by **verified** email (ADR-009 point 4, amended 18 Nov 2026):
  - `email_verified: true` counts as verified.
  - So does a token from our tenant's issuer with no `email_verified` claim: the tenant's metadata lists no such claim, but the tenant verifies every email before it creates an account.
  - An explicit `false`, or any other issuer without `true`, never creates or joins a user ("Verify your email to continue.").
- The session cookie `__Host-aivera-session` holds only the identity user id, encrypted with `AUTH_SECRET`.
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

## Owner steps still open

1. **Apply `infra/main.bicep`.** It gives the web app the five settings; the app identity already has Key Vault Secrets User. `deploy-dev.yml` updates only the image, so the settings arrive with the apply. Both Key Vault secrets exist.
2. **Wrong-password copy.** The password page belongs to the tenant. Set its error text to "That email and password do not match." under Company branding → Language customization; the default already does not say whether the email exists. Raise the password minimum to 12 characters, per the SignUp copy, if the tenant allows it.

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
