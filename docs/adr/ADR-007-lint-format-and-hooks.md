# ADR-007: Lint, format and Git hooks

- **Status:** Accepted, 18 Nov 2026
- **Ticket:** AIV-P0-001 (decision), AIV-P0-002 (implementation)

## Context

Medvya used oxlint with per-glob overrides to enforce front-end layers and design rules, but copied its lint config into each app. Several agents will commit in parallel here, so checks must run before code reaches CI and must be identical everywhere.

## Decision

1. **oxlint** for linting, with one base config in `packages/config/oxlint/` that every package extends. Layer rules (ADR-003), cross-feature rules, `react/jsx-no-literals` in features, and `no-restricted-imports` for module boundaries live in the base. Warnings fail CI (`--deny-warnings`).
2. **TypeScript** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; `pnpm typecheck` runs `tsc --noEmit` per package.
3. **Prettier** for formatting (TypeScript, JSON, Markdown, YAML, CSS), one config at the root.
4. **lefthook** Git hooks: `pre-commit` runs oxlint and Prettier on staged files; `commit-msg` rejects a message without a ticket key (`AIV-P<n>-<nnn>` or `AIV-P<n>-E<nn>`). Hooks are never bypassed (`--no-verify` is blocked by the Claude guard hook too).
5. **CI** (`.github/workflows/pr.yml`) runs install with a frozen lockfile, lint, typecheck, unit and architecture tests, integration tests on PostgreSQL, build, the link check and a secret scan. Required checks: `web` and `secrets`.
6. **Dependabot** weekly with a 14-day cooldown; minor and patch grouped, majors separate.

## Consequences

- A rule added to the base config applies to every package at once.
- Commits are traceable to tickets, which keeps Project 2 accurate for parallel agents.
