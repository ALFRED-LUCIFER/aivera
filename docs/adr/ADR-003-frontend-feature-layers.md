# ADR-003: Front-end feature layers on the Next.js App Router

- **Status:** Accepted, 18 Nov 2026
- **Ticket:** AIV-P0-001

## Context

The Medvya front end (a React SPA) used four lint-enforced layers per feature (domain, services, hooks, components) with controller hooks. Aivera uses the Next.js App Router, where pages can be Server Components that load data on the server. The layering must survive that without mixing data access into presentational code.

## Decision

```
src/app/                         routes, layouts, loading/error files; composition only
src/features/<feature>/domain/   pure TS: types, rules, zod schemas, table columns, query keys
src/features/<feature>/services/ I/O only: server actions ("use server"), route-handler calls, storage, browser APIs
src/features/<feature>/hooks/    client controller hooks useXxxController(): TanStack Query, RHF + Zod, state → view model + handlers
src/features/<feature>/components/ presentational .tsx: props in, events out
src/features/<feature>/index.ts  the feature's public API for other features
```

1. **Server-rendered pages**: a page in `app/` resolves the session and workspace, calls module contracts through the app's composition root (`src/server/composition.ts`), and renders a feature component with plain, serialisable props. No data access inside `components/`.
2. **Interactive parts**: a client component in `app/` (or a small client wrapper) calls `useXxxController()` and spreads the view model into the presentational component. Controllers seed TanStack Query from server-loaded data where needed.
3. **Server actions** live in `services/` of the feature that owns them, validate input with the feature's zod schema, check authorisation, and call module contracts. They return plain data or a typed error.

### What each layer may import (oxlint, per glob, from the shared base config)

| Layer | May | Must not |
|---|---|---|
| `domain/` | types, pure functions, zod | React, Next, `@aivera/ui`, services, hooks, components, fetch, window, storage |
| `services/` | server-only module contracts, fetch, storage, browser APIs | React, `@aivera/ui`, hooks, components |
| `hooks/` | React, TanStack Query, RHF, services, domain | components, `@aivera/ui`, raw fetch or storage |
| `components/` | `@aivera/ui`, rendering, i18n, local UI state | services, hooks, `@tanstack/*`, fetch, any storage API; non-`.tsx` files |
| other features | `../<other>/index.ts` or `../<other>/domain/*` | another feature's hooks, services or components |
| `app/` | wiring, providers, composition root | business rules |

4. Server state: TanStack Query only; the cache is cleared on workspace switch and sign-out. Forms: React Hook Form + Zod. No other state library without an ADR.
5. All user-facing text comes from `@aivera/i18n`; `react/jsx-no-literals` is on in features.

## Consequences

- Domain and services test without React; controllers test with `renderHook`; components test with plain props and axe.
- Every data read and write is in a small `services/` surface, which keeps security review findable.
- Server Components reduce client JavaScript without breaking the layer rules.
