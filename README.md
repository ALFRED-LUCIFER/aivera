# Aivera

Evidence intelligence for hiring: candidates are ranked on work you can inspect, every score cites its source, and a person makes every decision. See [PRODUCT.md](PRODUCT.md).

**Rules for humans and AI agents:** [AGENTS.md](AGENTS.md) (Claude Code reads it through [CLAUDE.md](CLAUDE.md)). **Design system:** [DESIGN.md](DESIGN.md). **Work:** GitHub issues on [Project 2](https://github.com/users/ALFRED-LUCIFER/projects/2); every ticket has Gherkin acceptance criteria.

## Stack

TypeScript end to end on Azure ([ADR-001](docs/adr/ADR-001-technology-stack.md)): Next.js 16 (App Router) + React 19, a Node worker, PostgreSQL with Drizzle ORM and Drizzle Kit migrations, Azure AI Foundry through the AI SDK, Tailwind 4 + shadcn/ui, Vitest, Playwright, Testcontainers, oxlint, Prettier, Turborepo, pnpm.

## Prerequisites

- Node 24 LTS (`nvm use` reads `.nvmrc`) and pnpm 11 (`corepack enable`)
- Docker (PostgreSQL for local development and integration tests)

## Local start

The workspace, toolchain and migrations arrive with AIV-P0-002; the commands are listed in [`docs/runbooks/`](docs/runbooks/) once they exist.

## Repository structure

Layout and rules: [ADR-002](docs/adr/ADR-002-repository-layout.md). **No empty scaffolding**: a folder is created by the ticket that builds it.

| Path | What | State |
|---|---|---|
| `AGENTS.md`, `CLAUDE.md`, `PRODUCT.md`, `DESIGN.md`, `SECURITY.md` | Rules, product, design system | Built (AIV-P0-001) |
| `docs/` | Product, design journeys, architecture, ADRs, runbooks | Built (AIV-P0-001) |
| `.claude/` | Claude Code settings, guard hook, `code-reviewer` and `ticket-writer` agents | Built (AIV-P0-001) |
| `.github/` | PR template, ticket issue template (Gherkin), CODEOWNERS, Dependabot | Built (AIV-P0-001) |
| `tools/check-links/` | Relative Markdown link check | Built (AIV-P0-001) |
| `apps/web/` | Next.js app: marketing, recruiter app, candidate site, portal, client view | Planned (AIV-P0-002) |
| `apps/worker/` | Queue consumers and scheduled jobs | Planned (P0 worker ticket) |
| `modules/<m>/` | Bounded contexts (`@aivera/<m>`), one PostgreSQL schema each | Planned (per module ticket) |
| `packages/config`, `tokens`, `ui`, `db` | Shared config, design tokens, design system, database and migrations | Planned (AIV-P0-002) |
| `tests/architecture`, `tests/integration`, `tests/e2e` | Boundary rules, PostgreSQL tests, journeys J0–J7 | Planned (AIV-P0-002 and journey tickets) |
| `infra/` | Bicep for Azure UAE North | Planned (P0 infra ticket) |
