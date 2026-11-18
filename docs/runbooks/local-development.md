# Local development

## First run

```sh
nvm use                      # Node 24 from .nvmrc
corepack enable              # pnpm 11 from package.json
pnpm install                 # also installs the lefthook Git hooks
pnpm services:up             # PostgreSQL 17 + pgvector on localhost:5432, with the aivera_migrator and aivera_app roles
cp .env.example .env.local   # then set the two database URLs below
pnpm db:migrate
pnpm dev                     # http://localhost:3000
```

Local values for `.env.local` (local-only passwords from `packages/db/sql/roles.sql`). The web app reads the same repo-root file and refuses to start if a required variable is missing, naming it (`apps/web/src/server/env.ts`):

```sh
APP_ENV=local
DATABASE_MIGRATOR_URL=postgres://aivera_migrator:local_dev_only@localhost:5432/aivera
DATABASE_URL=postgres://aivera_app:local_dev_only@localhost:5432/aivera
```

## Everyday commands

| Command                                                     | What it does                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | Every package, through Turborepo                                                     |
| `pnpm --filter <pkg> test`                                  | One package (`web`, `@aivera/ui`, `@aivera/db`, `@aivera/tests-integration`…)        |
| `pnpm format`                                               | Prettier over the repository                                                         |
| `pnpm db:generate`                                          | Drizzle Kit generates SQL migrations for every module whose schema changed (ADR-004) |
| `pnpm db:migrate`                                           | Applies every module's migrations in order; a rerun applies nothing                  |
| `pnpm --filter @aivera/tokens build`                        | Regenerates `tokens.css` after editing `tokens.json`                                 |
| `pnpm check:links` / `pnpm check:guard`                     | Markdown links; Claude guard hook self-test                                          |

## End-to-end tests and the component gallery (Playwright)

`pnpm test` is Vitest only; Playwright runs separately. The gallery at `http://localhost:3000/dev/gallery` (under `pnpm dev`) shows every `@aivera/ui` component in each state, with a light/dark toggle. It is a `page.dev.tsx` route: `next.config.ts` adds that extension only for `next dev`, so no build contains the gallery or its demo text. `tests/e2e` also covers the recruiter shell at `/app`, which renders only under `next dev` too.

| Command                                                            | What it does                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @aivera/tests-e2e exec playwright install chromium` | Once per machine: the browser Playwright drives                                                                    |
| `pnpm e2e`                                                         | Starts `next dev` on port 3200 (never 3000) and runs `tests/e2e`: axe in light and dark, browser checks, snapshots |
| `pnpm e2e -g "forced colours"`                                     | Only the tests whose title matches                                                                                 |
| `pnpm e2e:update`                                                  | Regenerates every baseline in the Playwright image, removing orphans; add `-g "<title>"` for only some             |

**Visual baselines are Linux only.** macOS renders text differently, so on a Mac `pnpm e2e` skips every screenshot comparison and runs everything else. Baselines are made and compared in `mcr.microsoft.com/playwright:v<version>-noble`, the same image the CI `e2e` job runs in, on `linux/amd64` like the runner (emulated on Apple Silicon, so the update takes a few minutes; arm64 Chromium antialiases differently).

To approve a visual change: run `pnpm e2e:update` (needs Docker; with Colima, nothing else), look at every changed PNG under `tests/e2e/src/*-snapshots/` in the diff, and commit them with the change. Never commit a `*-darwin.png`. When CI fails on a snapshot, download the `playwright-report` artifact from the run and open `index.html` to see the expected, actual and diff images.

When `@playwright/test` is upgraded, change the image tag in `.github/workflows/pr.yml` to the same version and rerun `pnpm e2e:update`.

## Adding a module's schema change

1. Edit `modules/<m>/src/infrastructure/schema.ts` (a workspace-owned table gets `workspace_id`, `tenantPolicy(name, t.workspaceId)` from `@aivera/db/tenant-policy` (the `nullif(current_setting('app.workspace_id', true), '')::uuid` policy) and `.enableRLS()`; ADR-005).
2. `pnpm db:generate`, read the SQL, commit it. For a new workspace-owned table also run `pnpm --filter @aivera/db exec drizzle-kit generate --custom --name force_rls` from the module folder and add `ALTER TABLE … FORCE ROW LEVEL SECURITY;`.
3. Add an integration test proving RLS isolates workspaces with the repository filter removed (copy `tests/integration/src/migrations-and-rls.test.ts`).
4. A new module adds its name to `MODULES` in `packages/db/src/modules.ts`, in dependency order.

## Docker with Colima

Testcontainers does not find Colima's socket by itself. Before integration tests:

```sh
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
```

Docker Desktop needs nothing. Never restart Colima or prune volumes on a shared machine (AGENTS.md 2.10).
