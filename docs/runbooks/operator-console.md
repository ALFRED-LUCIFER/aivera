# Operator console

The console at `/ops` is for the people who run Aivera. It is not for workspace admins. Who may open it, what it reads and how it is audited: [ADR-012](../adr/ADR-012-operator-console.md). Operators are the emails in `PLATFORM_OPERATOR_EMAILS`. If the setting is unset, empty or invalid, nobody gets in (fails closed).

**The emails go only into the Key Vault secret or your `.env.local`.** They never go in the repository, an issue, a PR, a log or CI output (AGENTS.md 1.1, 1.11). Tests use the synthetic Pia Platform and Theo Platform ([personas](../00-product/personas.md)).

## Signing in as an operator

1. Sign in on the normal sign-in page (`/sign-in`) with your own account on the same External ID tenant ([recruiter sign-in](recruiter-sign-in.md)).
2. Open `/ops`. If you were not signed in, `/ops` sends you to sign in and brings you back.
3. You see "Aivera operations" and "Signed in as an Aivera operator." Anyone else gets the 403 page.

Your email must be the one the identity module stored for you: your verified sign-in email, lower-case. The list is compared case-insensitively.

## Setting the list on Azure dev (owner)

Agents never write Key Vault or apply infrastructure (CLAUDE.md 7). Sign in with MFA first: `az login`, then `az account set -s "Subscription 1"`.

1. **Create the secret before the Bicep apply.** `infra/modules/web.bicep` references `platform-operator-emails` in Key Vault. If the secret is missing, the new revision fails to start. Set it once, with the operators' emails comma-separated (you need Key Vault Secrets Officer on the vault):

   ```sh
   az keyvault secret set --vault-name kv-aivera-dev-3afs7i --name platform-operator-emails --value '<email 1>,<email 2>'
   ```

   To keep the console closed for now, set any value that is not an email list, for example `none`. The app then logs `platform operator config invalid` at start-up and lets nobody in.

2. **Apply the web Bicep change** (the what-if and create commands are in [infra/README.md](../../infra/README.md)). A normal deploy (`deploy-dev.yml`) only swaps the image, so it does not add the setting. Until this apply runs, the console fails closed.
3. **Changing the list later:** set a new secret value with the command in step 1. Then restart the active revision, because the app reads its settings when it starts:

   ```sh
   az containerapp revision restart -g rg-medvya-dev-in -n ca-aivera-web-dev \
     --revision "$(az containerapp show -g rg-medvya-dev-in -n ca-aivera-web-dev --query properties.latestRevisionName -o tsv)"
   ```

   Once the revision restarts, a removed operator gets 403 on their next request.

## Setting the list locally

Add the emails to the repository-root `.env.local` (untracked), then restart `pnpm dev`:

```sh
PLATFORM_OPERATOR_EMAILS=pia.platform@example.com,theo.platform@example.com
```

Use your own sign-in email locally, or a synthetic one with the mocked provider. Leaving it empty keeps the console closed.

## When it does not let you in

- **403 for an operator:** check that the email in the list is the one you sign in with, and that the app restarted after the change. If the log shows `platform operator config invalid`, an entry is not an email (watch for a trailing comma or a space inside an address). The whole list is then ignored.
- **The revision does not start after the apply:** the `platform-operator-emails` secret is missing from the vault, or the app identity cannot read it. Create it (step 1) and restart the revision.

## Audit

Every operator action is written to the platform audit log `audit.platform_entry` (ADR-012 point 8). The app can only insert into it. Opening the console writes `ops.console_opened` once per browser session.
