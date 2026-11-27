# Local development

## First run

```sh
nvm use                      # Node 24 from .nvmrc
corepack enable              # pnpm 11 from package.json; if `pnpm -v` still says 10, run `corepack pnpm` (pnpm 10 rewrites the lockfile)
export CI=true               # agents and scripts: pnpm otherwise waits on a TTY prompt
pnpm install                 # also installs the lefthook Git hooks
pnpm services:up             # PostgreSQL 17 + pgvector on localhost:5432, with the aivera_migrator, aivera_app and aivera_relay roles
cp .env.example .env.local   # then set the two database URLs below
pnpm db:migrate
pnpm db:seed                  # the synthetic demo workspace (needs APP_ENV=local)
pnpm dev                     # http://localhost:3000
```

A database volume created before AIV-P3-002 lacks the `aivera_public` role the candidate site's job pages read as. Add it once, then migrate so it gets its grants: `docker compose exec postgres psql -U aivera -d aivera -c "CREATE ROLE aivera_public NOLOGIN; GRANT aivera_public TO aivera_app;"` and `pnpm db:migrate`.

A database volume created before AIV-P0-030 lacks the `vector` extension the `search` migrations need (only a superuser may create it). Add it once: `docker compose exec postgres psql -U aivera -d aivera -c "CREATE EXTENSION IF NOT EXISTS vector"`, then `pnpm db:migrate`.

Local values for `.env.local` (local-only passwords from `packages/db/sql/roles.sql`). The web app reads the same repo-root file and refuses to start if a required variable is missing, naming it (`apps/web/src/server/env.ts`):

```sh
APP_ENV=local
DATABASE_MIGRATOR_URL=postgres://aivera_migrator:local_dev_only@localhost:5432/aivera
DATABASE_URL=postgres://aivera_app:local_dev_only@localhost:5432/aivera
```

A database volume created before AIV-P0-014 lacks the outbox relay's role, so `pnpm db:migrate` fails on the candidates outbox migration (its policies name the role) and applies nothing of that module. Add it once: `docker compose exec postgres psql -U aivera -d aivera -c "CREATE ROLE aivera_relay LOGIN PASSWORD 'local_dev_only'; GRANT CONNECT ON DATABASE aivera TO aivera_relay"`.

The worker (`pnpm --filter worker start`) runs the outbox relay and the queue consumers, with probes on `PORT` (8080). It needs `ACS_ENDPOINT`, `EMAIL_SENDER` and `NOTIFICATIONS_ENCRYPTION_KEY` (email, AIV-P0-017; a real ACS resource, signed in with `az login`), `DATABASE_URL`, `RELAY_DATABASE_URL=postgres://aivera_relay:local_dev_only@localhost:5432/aivera` and `AZURE_SERVICE_BUS_NAMESPACE` (a real namespace, signed in with `az login`). With `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_APP_INSTALLATION_ID` (a GitHub App installation) it also reads candidates' public GitHub repositories (AIV-P1-026); without them repository reads stay queued. It is not needed for the web app: events wait in the outbox until a relay sends them.

Leave `APPLICATIONINSIGHTS_CONNECTION_STRING` empty locally: telemetry then stays off and `@credalent/observability`'s logger writes redacted JSON lines to stdout only. Log through `log` from `@credalent/observability` (message template plus ids, never candidate values); it redacts keys like `email`, `phone`, `name`, `text` and `prompt`, and strips query strings, before anything is written or exported.

Recruiter sign-in needs the External ID settings ([recruiter-sign-in.md](recruiter-sign-in.md)); without them `/sign-in` renders but every `/app` page redirects to it. Candidate sign-in works the same way with its own two settings ([candidate-sign-in.md](candidate-sign-in.md)); without them every `/candidates/me` page redirects to `/candidates/sign-in`. `pnpm e2e` signs in through a mocked provider instead and needs the migrated database above (or `E2E_DATABASE_URL`).

## Everyday commands

| Command                                                     | What it does                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | Every package, through Turborepo                                                                                                                                                                                                                                                                                                                                      |
| `pnpm --filter <pkg> test`                                  | One package (`web`, `@credalent/ui`, `@credalent/db`, `@credalent/tests-integration`…)                                                                                                                                                                                                                                                                                |
| `pnpm format`                                               | Prettier over the repository                                                                                                                                                                                                                                                                                                                                          |
| `pnpm db:generate`                                          | Drizzle Kit generates SQL migrations for every module whose schema changed (ADR-004)                                                                                                                                                                                                                                                                                  |
| `pnpm db:migrate`                                           | Applies every module's migrations in order; a rerun applies nothing                                                                                                                                                                                                                                                                                                   |
| `pnpm db:seed` / `pnpm db:seed --reset`                     | Seeds the demo workspace "Meridian Talent" from `tools/seed/src/cast.ts`; a rerun changes nothing; `--reset` purges and reseeds it (synthetic only), which also moves the five demo interviews to days counted from today, and is how an existing dev database picks up a changed cast: a plain rerun keeps the old one. Refused unless `APP_ENV` is `local` or `dev` |
| `pnpm --filter @credalent/tokens build`                     | Regenerates `tokens.css` after editing `tokens.json`                                                                                                                                                                                                                                                                                                                  |
| `pnpm check:links` / `pnpm check:guard`                     | Markdown links; Claude guard hook self-test                                                                                                                                                                                                                                                                                                                           |

## End-to-end tests and the component gallery (Playwright)

`pnpm test` is Vitest only; Playwright runs separately. `pnpm test` runs one package at a time (`turbo run test --concurrency=1`): each Vitest run already starts a worker for every core but one, and packages side by side timed tests out at 5 s (AIV-P0-936). The gallery at `http://localhost:3000/dev/gallery` (under `pnpm dev`) shows every `@credalent/ui` component in each state, with a light/dark toggle. It is a `page.dev.tsx` route: `next.config.ts` adds that extension only for `next dev`, so no build contains the gallery or its demo text. `tests/e2e` also covers the recruiter shell at `/app`; its global setup (`tests/e2e/seed.ts`) gives the synthetic cast their workspaces in the e2e database before the browser signs in. A second global setup (`tests/e2e/warm.ts`) then opens every page once, so `next dev` compiles each route before a test's timeouts start.

| Command                                                               | What it does                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @credalent/tests-e2e exec playwright install chromium` | Once per machine: the browser Playwright drives                                                                    |
| `pnpm e2e`                                                            | Starts `next dev` on port 3200 (never 3000) and runs `tests/e2e`: axe in light and dark, browser checks, snapshots |
| `pnpm e2e -g "forced colours"`                                        | Only the tests whose title matches                                                                                 |
| `pnpm e2e:update`                                                     | Regenerates every baseline in the Playwright image, removing orphans; add `-g "<title>"` for only some             |

**Visual baselines are Linux only.** macOS renders text differently, so on a Mac `pnpm e2e` skips every screenshot comparison and runs everything else. Baselines are made and compared in `mcr.microsoft.com/playwright:v<version>-noble`, the same image the CI `e2e` job runs in, on `linux/amd64` like the runner (emulated on Apple Silicon, so the update takes a few minutes; arm64 Chromium antialiases differently).

To approve a visual change: run `pnpm e2e:update` (needs Docker), look at every changed PNG under `tests/e2e/src/*-snapshots/` in the diff, and commit them with the change. Never commit a `*-darwin.png`. When CI fails on a snapshot, download the failing shard's `playwright-report-<shard>` artifact from the run (`gallery-1` to `gallery-3`, or `publish-unconfigured`) and open `index.html` to see the expected, actual and diff images.

When `@playwright/test` is upgraded, change the image tag in `.github/workflows/pr.yml` to the same version and rerun `pnpm e2e:update`.

### Known quirks (found by agents, Nov 2026)

- **`pnpm e2e:update` starts no database.** `tests/e2e/docker.sh` passes no `E2E_DATABASE_URL`, so pages behind sign-in cannot render in it. For those baselines, run by hand: a `pgvector` container on a private Docker network with `packages/db/sql/roles.sql` mounted as an initdb script; in the Playwright image `pnpm install --frozen-lockfile --ignore-scripts` (without `CI=true`: a later reinstall runs lefthook, which fails with no `.git`); `node src/cli.ts migrate` in `packages/db` with `DATABASE_MIGRATOR_URL`; then `pnpm e2e --project=gallery --workers=1 --update-snapshots=changed <specs>` with `E2E_DATABASE_URL` set (the flag needs `=mode` before spec arguments).
- **Some baselines depend on spec order.** `shell-desk-*` and `shell-menu-open-768` show "Applied AI Engineer, version 3" only when `rubric-edit.spec.ts` ran first. A partial update includes it, on one worker, before `shell.spec.ts`.
- **A sidebar change** touches seven Linux baselines (`shell-desk-{light,dark}`, `shell-menu-open-768`, `jobs-list-{light,dark}`, `import-{light,dark}`) and `apps/web/src/app/(recruiter)/app/RecruiterShell.test.tsx`, which lists the sidebar sections: run `vitest run src` in `apps/web`, not only `src/features`.
- **Platform-only and flaky specs.** `import.spec.ts` "ArrowDown" fails on macOS by design (Linux Chromium only). `clients.spec.ts` "add clients… archive one" has flaked once in CI (the archive dialog not found, then its retry fails on leftover state); rerun the failed shard before treating it as a fault.
- **Running every suite at once** times out `tests/architecture`'s whole-repo scans and Testcontainers start-up. Rerun the suite alone before calling it a failure.

## Adding a module's schema change

1. Edit `modules/<m>/src/infrastructure/schema.ts` (a workspace-owned table gets `workspace_id`, `tenantPolicy(name, t.workspaceId)` from `@credalent/db/tenant-policy` (the `nullif(current_setting('app.workspace_id', true), '')::uuid` policy) and `.enableRLS()`; ADR-005).
2. `pnpm db:generate`, read the SQL, commit it. For a new workspace-owned table also run `pnpm --filter @credalent/db exec drizzle-kit generate --custom --name force_rls` from the module folder and add `ALTER TABLE … FORCE ROW LEVEL SECURITY;`.
3. Add an integration test proving RLS isolates workspaces with the repository filter removed (copy `tests/integration/src/migrations-and-rls.test.ts`).
4. A new module adds its name to `MODULES` in `packages/db/src/modules.ts`, in dependency order.

The migration has to be safe on a live database (AIV-P2-061). `tests/architecture/src/migrations.test.ts` and CI check it:

- **Journal order.** Drizzle's migrator skips, with no error, a migration whose journal `when` is not later than the last one applied. Every module journal's `when` must be strictly increasing. After a rebase, regenerate your migration; never edit `when` by hand.
- **Generated, not hand-written.** CI runs `pnpm db:generate` and fails when `git status --porcelain` then lists any file, so a schema change without its migration fails.
- **No NOT NULL column without a default on an existing table.** Add it nullable or with a `DEFAULT`, backfill, then `SET NOT NULL` in a later migration.
- **CHECK constraints on `audit` are added `NOT VALID`.** A plain `ADD CONSTRAINT … CHECK` checks every row of the audit log under an exclusive lock. Edit the generated SQL to `ADD CONSTRAINT … CHECK (…) NOT VALID`. Widening an allowed list needs nothing more: every existing row already met the narrower check. Put any `VALIDATE CONSTRAINT` in a migration that ships in a later deploy. The runner applies all of a module's pending migrations in one transaction, so a `VALIDATE` in the same deploy still holds the exclusive lock.
- **No `CREATE INDEX CONCURRENTLY`.** It cannot run inside that transaction. Plain `CREATE INDEX` blocks writes to the table while it builds, so keep it to tables that are small at the time.

## Docker: Docker Desktop or Colima

Docker Desktop needs nothing. Testcontainers does not find Colima's socket by itself; with Colima (`docker context ls` shows which is active), before integration tests:

```sh
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
```

Never restart Docker or Colima or prune volumes on a shared machine (AGENTS.md 2.10).
