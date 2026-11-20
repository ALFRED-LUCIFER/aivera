# Operator console

The console at `/ops` is for the people who run Credalent. It is not for workspace admins. Who may open it, what it reads and how it is audited: [ADR-012](../adr/ADR-012-operator-console.md). Operators are the emails in `PLATFORM_OPERATOR_EMAILS`. If the setting is unset, empty or invalid, nobody gets in (fails closed).

**The emails go only into the Key Vault secret or your `.env.local`.** They never go in the repository, an issue, a PR, a log or CI output (AGENTS.md 1.1, 1.11). Tests use the synthetic Pia Platform and Theo Platform ([personas](../00-product/personas.md)).

## Signing in as an operator

1. Sign in on the normal sign-in page (`/sign-in`) with your own account on the same External ID tenant ([recruiter sign-in](recruiter-sign-in.md)).
2. Open `/ops`. If you were not signed in, `/ops` sends you to sign in and brings you back.
3. You see "Credalent operations" and "Signed in as a Credalent operator." Anyone else gets the 403 page.

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

## Workspaces

`/ops/workspaces` lists every workspace, newest first, 50 per page: name, type, created date (in the time zone the column header states), active members, jobs, status and plan ("No plan yet" until recruiter pricing, AIV-P5-013). Demo and test workspaces carry the "Synthetic" badge. Search matches part of the name in any case; the search is sent in the request body, so it never appears in a URL. Open a workspace for its detail page at `/ops/workspaces/<opaque id>`.

The console shows platform facts and counts only, never a member, a candidate or a job's content. Each workspace is read inside its own scope under the normal tenant policies (ADR-012 point 6). The list comes from `workspaces.directory`. On Azure dev, workspaces created before AIV-P2-036 are listed only if they were someone's active workspace when it deployed (the migration backfills from that table); a dev workspace missing from the list was nobody's active workspace and holds synthetic data only. The list reads every workspace on each search, so it slows down past a few hundred workspaces; the upgrade is the `aivera_ops` role in ADR-012.

## Suspending and reactivating a workspace

On a workspace's detail page, "Suspend workspace" opens the preview: members can still read everything; new work, AI calls and emails stop; nothing is deleted. Give a reason of at least 10 characters (it is recorded, and members never see it), then Confirm. "Reactivate" works the same way on a suspended workspace. The "Operator actions" card lists each change with its time and reason.

While a workspace is suspended:

- Its members see a banner on every recruiter page and can open everything they could before. Anything that would start new work (adding a job, publishing, approving a rubric, every later action) is refused on the server with 403 "This workspace is paused."
- Its public jobs are hidden from the candidate site (an old link reads "no longer open") and come back on reactivation.
- Candidates, rankings and scores are untouched: nothing is deleted, hidden or reordered (AGENTS.md 1.5, 1.8).
- Not built yet, so nothing to stop: the worker, AI calls, outbound email and candidate evidence uploads. When they land, they go through the same check (the module README says how).

## Approving new workspaces

While "New workspaces need approval" is on (the default for dev and the pilot), a workspace created on the sign-up page waits: its creator sees "Your workspace is waiting for approval" on every recruiter page, and the server refuses new work in it. `/ops/approvals` lists the waiting workspaces, oldest first, with their type, created date and the creator's email.

- **Approve** opens the preview; Confirm makes the workspace active, and its creator can add jobs at once.
- **Reject** needs a reason of at least 10 characters. The creator sees "Your workspace was not approved. Reason: …". The workspace stays, with no new work, for audit.
- **Email the creator yourself** for now: the approval emails ("Your Credalent workspace is approved" / "… was not approved") arrive with AIV-P0-017, which is not built. The waiting page already promises an email, so do not leave a decision unsent.
- **The switch** ("Turn off" / "Turn on", with a reason) changes only what happens to the next sign-ups. Turning it off approves nothing: workspaces already waiting stay waiting until you decide each one. Existing and seeded workspaces, and people invited into an existing workspace, are never affected.

## Audit

Every operator action is written to the platform audit log `audit.platform_entry` (ADR-012 point 8). The app can only insert into it. Opening the console writes `ops.console_opened` once per browser session. Opening a workspace's detail page writes `ops.workspace_viewed` with the workspace's id, on the server before the page renders. A suspension or reactivation writes `workspace.suspended` or `workspace.reactivated` with the reason, both there and in the workspace's own audit log with actor `operator:<user id>`, in the same transaction as the change. Approving and rejecting write `workspace.approved` and `workspace.rejected` (with the reason) the same way; turning the switch writes `ops.approval_mode_changed` to the platform log, with the value before and after and the reason.

**Audit log** (`/ops/audit`, AIV-P2-054) lists the platform log newest first, 50 a page with "Next page" (the browser's back button returns), through `audit.listPlatformEntries` only. Each row: time in UTC, the operator's display name (never an email; "Name not set" when the identity user has none), the action's name, the target (a link for a workspace), the reason and the values before and after. Filters are a form whose values go in the URL: an action key, an operator's opaque user id, a target id and UTC days (`from` and `to`, both included), never a name or email; an empty or invalid value is dropped from the URL. The operator filter lists who acted in the newest 500 entries (a recorded shortcut). Reading the log is not itself audited.
