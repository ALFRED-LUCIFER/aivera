# ADR-002: Repository layout and modular monolith in TypeScript

- **Status:** Accepted, 18 Nov 2026
- **Ticket:** AIV-P0-001

## Context

The Medvya blueprint (a .NET modular monolith with DDD module boundaries, a feature-layered React front end, and test-enforced rules) kept a large codebase clean. Its own review found nine things to fix on day one in a new app: cross-feature imports were not lint-guarded, plain TypeScript hid in `components/`, screens and controllers grew too large, the API client was only half adopted, routes were written by hand twice, use cases sat in Infrastructure, there were no Contracts projects, docs drifted, and lint config was copied per app. This ADR carries the blueprint over to TypeScript and fixes those from the start.

## Decision

```
apps/web/                 Next.js app: marketing, recruiter app, candidate site, portal, client view
  src/app/                routing and composition only
  src/features/<f>/{domain,services,hooks,components}
apps/worker/              queue consumers and scheduled jobs; composition only
modules/<m>/              one bounded context, package @credalent/<m>, one PostgreSQL schema
  src/domain/             entities, value objects, invariants; pure
  src/application/        use cases over narrow ports
  src/contracts/          the ONLY public surface: interfaces, zod DTOs, versioned events
  src/infrastructure/     Drizzle schema, migrations, repositories, adapters
  src/composition.ts      builds the module (apps, tools/seed, tests)
packages/config/          shared tsconfig, oxlint and Vitest base configs
packages/tokens/          Case file tokens.json -> CSS variables
packages/ui/              design system (shadcn/ui + Radix + Tailwind 4) and its gallery
packages/i18n/            messages and formatting
packages/db/              PostgreSQL client, workspace-scoped transactions, migration runner
tests/architecture/       boundary rules     tests/integration/  Testcontainers PostgreSQL
tests/e2e/                Playwright journeys J0–J7
tools/                    repo checks        infra/  Bicep        docs/  product, design, architecture, ADRs, runbooks
```

1. **Module boundary.** A module's `package.json` `exports` exposes `"."` → `src/contracts/index.ts` and `"./composition"` → `src/composition.ts`, nothing else, so a deep import does not resolve. The architecture test additionally fails on relative imports that cross a module folder, on a module importing `/composition`, on a package importing an app, and on the forbidden pairs in [`modules.md`](../02-architecture/modules.md) (fixes blueprint items 7 and 6: Contracts exist from day one; use cases live in `application/`, Drizzle in `infrastructure/`).
2. **Cross-module talk**, in order of preference: call the other module's contract interface; publish or consume a versioned event through the outbox (payloads carry opaque ids); a participant interface for cross-cutting flows (merge, deletion), where each module touches only its own tables.
3. **Front-end feature boundaries** are lint-enforced, including between features (blueprint items 1 and 2): see ADR-003.
4. **Navigation map is the route source.** One `navigation.ts` in the shell feature lists screen → path → required capability → flag; sidebar and guards read it (blueprint item 5). Next.js file routes stay the router; a test fails when a map entry has no route or a route under `/app` has no map entry.
5. **One shared base config** in `packages/config` that every package extends (blueprint item 9).
6. **Docs that can drift are checked** (blueprint item 8): relative links are checked in CI; the README structure table and `modules.md` are updated by the ticket that creates a folder; an ERD generated from the Drizzle schemas lands with the first module.
7. **No empty scaffolding.** A folder is created by the ticket that builds it.

## Consequences

- Boundaries are enforced twice (package exports and the architecture test), so parallel agents cannot quietly couple modules.
- With TypeScript end to end, types flow from module contracts to the UI; the blueprint's generated OpenAPI client (item 4) is replaced by shared zod contracts. If a public API is added later, it gets an OpenAPI document generated from those schemas.
- Soft size budget (~200 lines per component or controller) is checked in review, not lint.
