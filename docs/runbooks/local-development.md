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

Local database URLs for `.env.local` (local-only passwords from `packages/db/sql/roles.sql`):

```sh
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
