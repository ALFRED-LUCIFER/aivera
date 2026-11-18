## Ticket

Closes #<!-- issue number --> · AIV-

Stack: <!-- e.g. #4 → **#181** → #2xx, or "none" (AGENTS.md 7.1) -->

## What changed


## How verified

<!-- Commands run and their result, tests added or run (name each Gherkin scenario and its test), browser check in light and dark, axe result. -->


## Not done / follow-up ticket

<!-- What is deliberately left out, and the ticket that covers it. "None" if nothing. -->


## Definition of Done ([AGENTS.md §5](../AGENTS.md#5--definition-of-done-every-pr))

- [ ] Every Gherkin scenario of the ticket passes
- [ ] **Synthetic data only**: no real person's data in code, tests, fixtures or logs
- [ ] `pnpm lint`, `pnpm typecheck`, affected tests and `pnpm build` pass locally; CI green
- [ ] Safety tests mutation-checked, each with its `// SAFETY: mutation check:` comment (name the tests):
- [ ] Database change: migration generated with `pnpm db:generate`, reviewed, forward-only; or no schema change
- [ ] X1 Security: server-side authorisation on new server actions, route handlers and jobs; input validated with zod; no secrets
- [ ] X2 Privacy: no candidate data in logs, telemetry or URLs; audit events for decisions, shares and score changes
- [ ] X3 Fairness and human decision: a person confirms every change; scores cite evidence; claims count zero; metrics carry a basis
- [ ] X4 States: empty, loading, error, 403 handled; no data loss on refresh
- [ ] X5 Accessibility and language: WCAG 2.2 AA, keyboard, strings in `packages/i18n`, logical utilities
- [ ] X6 Performance budgets met
- [ ] X7 Migrations forward-only; retries idempotent
- [ ] X8 Quality: unit, integration on PostgreSQL, and e2e where a journey is touched
- [ ] Docs, ADRs, README structure table updated where behaviour or layout changed
