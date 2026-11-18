# Aivera

Evidence intelligence for hiring: candidates are ranked on work you can inspect, every score cites its source, and a person makes every decision. See [PRODUCT.md](PRODUCT.md).

**Rules for humans and AI agents:** [AGENTS.md](AGENTS.md) (Claude Code reads it through [CLAUDE.md](CLAUDE.md)). **Design system:** [DESIGN.md](DESIGN.md). **Work:** GitHub issues on [Project 2](https://github.com/users/ALFRED-LUCIFER/projects/2); every ticket has Gherkin acceptance criteria.

## Stack

TypeScript end to end on Azure ([ADR-001](docs/adr/ADR-001-technology-stack.md)): Next.js 16 (App Router) + React 19, a Node worker, PostgreSQL with Drizzle ORM and Drizzle Kit migrations, Azure AI Foundry through the AI SDK, Tailwind 4 + shadcn/ui, Vitest, Playwright, Testcontainers, oxlint, Prettier, Turborepo, pnpm.

## Prerequisites

- Node 24 LTS (`nvm use` reads `.nvmrc`) and pnpm 11 (`corepack enable`)
- Docker (PostgreSQL for local development and integration tests)

## Local start

```sh
pnpm install && pnpm services:up && cp .env.example .env.local   # set the database URLs, see the runbook
pnpm db:migrate && pnpm dev
```

Everything else (commands, schema changes, Colima): [`docs/runbooks/local-development.md`](docs/runbooks/local-development.md).

## Repository structure

Layout and rules: [ADR-002](docs/adr/ADR-002-repository-layout.md). **No empty scaffolding**: a folder is created by the ticket that builds it.

| Path                                                                                                                       | What                                                                                                   | State                          |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `AGENTS.md`, `CLAUDE.md`, `PRODUCT.md`, `DESIGN.md`, `SECURITY.md`                                                         | Rules, product, design system                                                                          | Built (AIV-P0-001)             |
| `docs/`                                                                                                                    | Product, design journeys, architecture, ADRs, runbooks                                                 | Built (AIV-P0-001)             |
| `.claude/`                                                                                                                 | Claude Code settings, guard hook, `code-reviewer` and `ticket-writer` agents                           | Built (AIV-P0-001)             |
| `.github/`                                                                                                                 | PR template, ticket issue template (Gherkin), CODEOWNERS, Dependabot                                   | Built (AIV-P0-001)             |
| `tools/check-links/`, `tools/check-commit-msg/`, `tools/board/`                                                            | Markdown link check; ticket key in commit messages; Project 2 status helper                            | Built (AIV-P0-001, AIV-P0-002) |
| Root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `lefthook.yml`, `docker-compose.yml`, `.github/workflows/pr.yml` | Workspace, tasks, Git hooks, local PostgreSQL, CI                                                      | Built (AIV-P0-002)             |
| `apps/web/`                                                                                                                | Next.js app: marketing, recruiter app, candidate site, portal, client view. Placeholder page today     | Built (AIV-P0-002)             |
| `apps/worker/`                                                                                                             | Queue consumers and scheduled jobs                                                                     | Planned (P0 worker ticket)     |
| `modules/<m>/`                                                                                                             | Bounded contexts (`@aivera/<m>`), one PostgreSQL schema each                                           | Planned (per module ticket)    |
| `modules/audit/`                                                                                                           | Append-only audit log: who did what, when and why; enforced in PostgreSQL                              | Built (AIV-P0-013)             |
| `modules/workspaces/`                                                                                                      | Tenancy: workspaces, members, roles; row-level security                                                | Built (AIV-P0-008)             |
| `packages/config`                                                                                                          | Shared tsconfig, oxlint (base + web layers) and Vitest config                                          | Built (AIV-P0-002)             |
| `packages/tokens`                                                                                                          | Case file `tokens.json` → `tokens.css`                                                                 | Built (AIV-P0-002)             |
| `packages/ui`                                                                                                              | Base controls on Tailwind 4 and the tokens: Button, Input, Select, Checkbox, Dialog, Toast and more    | Built (AIV-P0-002, AIV-P0-019) |
| `packages/db`                                                                                                              | PostgreSQL client, `withWorkspace`, `tenantPolicy`, `uuidv7`, migration runner and CLI, roles          | Built (AIV-P0-002)             |
| `packages/i18n`                                                                                                            | Typed message catalogues (`messages/en.json`, ICU), `getTranslations`, date, money and percent helpers | Built (AIV-P0-026)             |
| `tests/architecture`, `tests/integration`                                                                                  | Boundary rules; PostgreSQL tests on Testcontainers                                                     | Built (AIV-P0-002)             |
| `tests/e2e`                                                                                                                | Playwright journeys J0–J7                                                                              | Planned (first journey ticket) |
| `infra/`                                                                                                                   | Bicep for Azure UAE North                                                                              | Planned (P0 infra ticket)      |
