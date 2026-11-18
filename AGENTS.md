# Rules for every AI assistant and human working on Aivera

**This file is the single source of truth for how code is written here.** `CLAUDE.md` imports it. If a rule looks wrong for a real case, change this file in the same PR; never ignore it silently.

Aivera ranks job candidates on evidence of their work and holds their CVs, documents and contact details in the UAE and KSA. A wrong score can cost someone a job. **Production quality is the only quality.** No prototypes, demo shortcuts or "fix later" code without a recorded `shortcut:` (see 2.6).

## 1 · Non-negotiable safety rules

1. **Synthetic data only.** Never put a real person's CV, name, email, phone, repository or employer in code, tests, fixtures, logs, screenshots, CI output, issues or AI evaluation sets. Use the synthetic cast in [`docs/00-product/personas.md`](docs/00-product/personas.md). Emails use `@example.com`, portfolio hosts use `.aivera.example`.
2. **Candidate personal data stays in the database and Blob.** Never in logs, telemetry, URLs, query strings, browser storage, email subjects, error messages or exception text. That covers names, contact details, CV text, evidence files, scores and interview notes. Telemetry is allowlist-scrubbed; never weaken it. URLs carry opaque ids and signed tokens only.
3. **Authorisation is server-side, on every server action, route handler and worker job:** workspace, role, and the job the record belongs to. Hiring owners and interviewers are job-scoped: they reach only the jobs (or the agency client's jobs) they are granted, and an action with no job is refused for them ([ADR-005](docs/adr/ADR-005-workspace-tenancy.md) point 6, [ADR-009](docs/adr/ADR-009-identity-and-account-model.md)). Hiding something in the UI is never the control. Every server entry point declares its policy or is explicitly public (test-enforced).
4. **Workspace isolation is two layers:** the repository's workspace filter **and** PostgreSQL row-level security on `app.workspace_id` with `FORCE ROW LEVEL SECURITY` ([ADR-005](docs/adr/ADR-005-workspace-tenancy.md)). Never bypass, disable or "temporarily" switch off either.
5. **A person makes every hiring decision.** Nothing rejects, advances, contacts or shares a candidate automatically. Ranking orders attention; lower-ranked candidates stay visible. AI output is a recommendation; every state change from the assistant or a bulk action is shown as a preview and applied only when a person confirms. Decisions record who, when and why in the audit log.
6. **Every score cites its evidence.** A competency score links to the exact source (commit range, document, reference, scorecard) and states its limit. A claim with nothing to inspect is labelled a claim and counts **zero** in the backed score; it may only widen the "up to N if claims hold" range. Nothing is called verified unless a second, independent source confirms it. Thin evidence is a gap to close, never a reason to reject.
7. **Every number states its basis:** observed, baseline, projection or not yet available. When no hire has completed, a metric shows "not yet available", never an invented figure.
8. **Paying never changes ranking.** Nothing in candidate Plus (billing, portfolio, tailoring) may be read by assessment or ranking (architecture-test-enforced). Tailoring reorders and rewords; it never adds a fact that is not in the candidate's CV or evidence.
9. **Clients and hiring owners see summaries and sources, not raw candidate files.** Candidate contact details stay private until the candidate accepts an introduction. Candidates can ask for their data to be deleted.
10. **Data stays in region.** Azure resources, AI inference and backups run in UAE North. No cross-region replication or inference without a new ADR.
    Exception: the dev environment, which holds synthetic data only, shares Medvya dev in Central India ([ADR-008](docs/adr/ADR-008-dev-environment-shares-medvya-dev.md)).
11. **Secrets** live only in Key Vault (cloud) or a local `.env.local` that is never committed. `.env.example` holds names, never values. Never commit a secret, even a test one that looks real.

## 2 · How to work

1. **Work from a ticket.** Every change references its key (`AIV-P1-013`) in the branch name, commit and PR. Read its Gherkin acceptance criteria and linked docs first. **Ticket status lives on GitHub:** the issue's `status:` label plus a comment (what started, what was delivered, what is pending), **and** its Project 2 board Status. Close an issue only when every scenario passes.
2. **Every ticket has Gherkin acceptance criteria** (a fenced `gherkin` block: Feature, user story, concrete Scenarios). A ticket without them is not ready to build; write them first (`.claude/agents/ticket-writer.md`).
3. **Smallest complete change: the Ponytail discipline is mandatory for writing any code** (the `ponytail` plugin, level `full`; Claude Code loads it from `.claude/settings.json`). Solve the whole ticket with the least new code. Reuse before adding; no speculative abstractions or "for later" code. Finish every part the change touches: callers, tests, docs, translations.
4. **Read before you write.** Find every caller, test and config your change reaches. Fix root causes in shared code, not symptoms at call sites.
5. **Tests prove behaviour.** New logic (branch, parser, score, money, security, tenancy, consent) ships with a test. A safety-critical test must be shown to **fail when the protection is removed** (mutation check) before the PR, recorded next to the test as `// SAFETY: mutation check: <what was removed> -> <test> failed`. A test that cannot fail proves nothing.
6. **Shortcuts are written down.** A known limit gets a code comment `shortcut: <the limit>, <when to upgrade>`. Untracked shortcuts are bugs.
7. **Never weaken a guard to get green.** Do not disable lint rules, tests, audit or CI checks, or lower thresholds, to make a change pass. Fix the code. A justified, narrow suppression needs a comment with the reason.
8. **Verify for real, with Playwright.** UI changes are proven by Playwright tests that run in CI: the journey step or component story, keyboard path, `@axe-core/playwright` with no violations, and light and dark. An agent does not hand-drive a browser to verify (it costs tokens and leaves no regression test); it writes or extends the Playwright test instead, and drives a browser only to debug a failing one. Database changes: run against real PostgreSQL (Testcontainers). Never claim "done" from a passing build alone.
9. **Comments explain why**, in one line, only where the code cannot.
10. **Parallel agents.** Each agent works in its own git worktree on its own branch, with non-overlapping files; check `git branch --show-current` before committing. A ticket that depends on an unmerged ticket is built as a stacked PR on top of it (7.1). One agent at a time drives the Playwright browser. Never restart Docker or prune volumes on a shared machine. Details: [`docs/runbooks/parallel-agents.md`](docs/runbooks/parallel-agents.md).

## 3 · Back end (TypeScript, `modules/`, `apps/worker`, server code in `apps/web`)

1. **Modular monolith** ([ADR-002](docs/adr/ADR-002-repository-layout.md)). A module is a package `modules/<m>` (`@aivera/<m>`) with `src/domain`, `src/application`, `src/contracts`, `src/infrastructure`. Other code imports a module **only through its contracts entry** (`@aivera/<m>`); the package `exports` map exposes nothing else except `@aivera/<m>/composition`, which only apps, `tools/seed` and the test suites (`tests/`) may import: they are composition roots too. Never another module's domain, infrastructure, tables or Drizzle schema (architecture-test-enforced). Talk through contract interfaces or versioned events through the outbox (`CandidateAssessed.v1`); event payloads carry opaque ids only.
2. **Domain is pure.** No database, HTTP, AI SDK or `Date.now()` in `domain/`. Use cases live in `application/` over narrow ports; Drizzle and adapters live in `infrastructure/`.
3. **Each module owns a PostgreSQL schema** named after it, with its own Drizzle schema and **forward-only SQL migrations generated by Drizzle Kit, committed and reviewed** ([ADR-004](docs/adr/ADR-004-database-and-migrations.md)). Never `drizzle-kit push` against a shared database. Never edit an applied migration; add a new one. Cross-module references are opaque ids, never foreign keys.
4. **Every workspace-owned table** has a `workspace_id` column, a row-level security policy on `app.workspace_id`, `FORCE ROW LEVEL SECURITY`, and an integration test proving RLS blocks a read with the repository filter removed.
5. **Invariants the database can enforce, it enforces** (unique indexes, check constraints, serializable transactions where order matters).
6. **The audit write is the last statement before commit.** Every hiring decision, stage change, score change, rubric approval, evidence request, share and deletion is audited with actor, time and reason. The audit log is append-only.
7. **Validate at every trust boundary with zod:** server action input, route handler body, queue message, webhook, AI output. AI output that fails its schema is rejected, never patched up.
8. Money is integer minor units plus ISO currency (`{ amountMinor: 4900, currency: 'AED' }`). Never floats for money.
9. Time is UTC `Date`/ISO strings from the injected clock (`Clock` port). Display in the viewer's workspace time zone, always explicit.
10. Raw SQL only through Drizzle's `sql` template (parameterised), never string-built.
11. **Webhooks** (Stripe and others) are explicitly public routes that verify the signature over the raw body before parsing, are idempotent on the provider's event id, never trust an amount or account from the payload, and never log the payload.
12. **AI calls** go through the AI platform module only ([ADR-006](docs/adr/ADR-006-ai-on-azure-foundry.md)): structured output with a zod schema, every claim in the output must cite an evidence id that exists, prompts versioned in code, and every prompt change runs the eval set.
13. Logging is structured (`pino`) with message templates and ids only; never candidate values. TypeScript `strict`, no `any`, no non-null assertions without a reason comment.

## 4 · Front end (Next.js 16 App Router, `apps/web`): hard rule, [ADR-003](docs/adr/ADR-003-frontend-feature-layers.md)

```
src/app/                           routing and composition only: layouts, pages that load data and render a feature component
src/features/<feature>/domain/     pure types, rules, zod schemas, table column definitions (no React, no I/O)
src/features/<feature>/services/   I/O only: server actions, route-handler calls, storage, browser APIs (no React)
src/features/<feature>/hooks/      client controller hooks useXxxController(): TanStack Query, React Hook Form + Zod, state; return view model + handlers
src/features/<feature>/components/ presentational .tsx only: props in, events out (no services, hooks, fetch, storage)
```

- Lint enforces the layers and the boundaries between features: a feature may import another feature only through that feature's `index.ts` public API or its `domain/`. Never another feature's hooks or components. Shared query keys live in `domain/queryKeys.ts`.
- Server Components in `app/` call module contracts through the app's composition root and pass plain data to components. Client interactivity goes through a controller hook. One controller per sub-flow (list, panel, dialog), not per page; soft budget ~200 lines per file.
- Server state: TanStack Query. Forms: React Hook Form + Zod (schemas in `domain/`). A small form that posts to a server action may instead be a native `<form>` with `useActionState`, validated by the same Zod schema on the server (sign-in, create workspace); add React Hook Form when a form needs client-side field state. No other state library without an ADR.
- UI is **shadcn/ui + Radix + Tailwind 4** from `@aivera/ui`. Never add another component library. Colours, spacing, radius and type come from the Case file tokens (`@aivera/tokens`); no raw hex in features.
- **No hard-coded user-facing text.** Every string is a key in `packages/i18n/messages/en.json`. Use logical utilities (`ms-*`, `ps-*`, `start-*`) so Arabic right-to-left works when it ships.
- Accessibility: WCAG 2.2 AA, keyboard path, visible focus ring, real `<button>`/`<a href>`/`<label>`, `aria-label` on icon-only buttons, 200% zoom, reduced motion. Targets 40 px standard, 44 px on touch.

**Design rules** ([DESIGN.md](DESIGN.md)). New code follows them.

- **Ink does the work.** Text, actions, scores and selection use ink. **The highlighter (`--hl`) marks cited evidence and nothing else.**
- **Status colour always travels with an icon and a word.** Never colour alone.
- **Every metric shows its value-basis marker** (observed, baseline, projection, not yet available).
- **Evidence provenance and strength** use the shared `ProvenanceTag` and `StrengthMeter` (neutral ink, so strength is not read as pass/fail).
- **Scores use `ScoreWithUncertainty`**: solid backed score, hatched claim range, "N backed by evidence · up to M if claims hold".
- **One primary button per view.** The assistant and bulk actions use the shared preview-confirm card: "Nothing changes until you confirm."
- **Use the shared component; never build a local copy.** A new shared component is not done until it is in the `@aivera/ui` gallery in light and dark.
- Motion: 120 ms, `cubic-bezier(.16,1,.3,1)`, named properties, never `transition-all`, off under `prefers-reduced-motion`. The website alone may sequence longer entrances in 120 ms steps (DESIGN.md).

## 5 · Definition of Done (every PR)

The only Definition of Done; the PR template links here.

- [ ] Every Gherkin scenario of the ticket passes and is demonstrated
- [ ] Locally: `pnpm lint`, `pnpm typecheck`, the tests your change affects, `pnpm build` for touched apps; CI runs the full suite
- [ ] New or changed behaviour tested; safety tests mutation-checked (2.5)
- [ ] UI verified in a browser in light and dark, keyboard path, axe clean
- [ ] Cross-cutting X1–X8 considered: X1 security, X2 privacy, X3 fairness and human decision (rules 1.5–1.8), X4 states (empty, loading, error, 403), X5 accessibility and language, X6 performance, X7 migrations and idempotent retries, X8 quality
- [ ] Docs, ADRs, README structure table and translations updated in the same PR when behaviour or decisions change
- [ ] Database change: migration generated with `pnpm db:generate`, reviewed, forward-only
- [ ] CI green. **Never merge red CI.** Never bypass hooks (`--no-verify`) or force-push `main`

## 6 · Dependencies

1. Prefer what is already installed. A new dependency needs a reason in the PR (what it replaces, why not the platform or standard library).
2. Versions are pinned through `pnpm-lock.yaml`. Dependabot PRs are reviewed weekly; majors are upgraded deliberately on one branch with a browser check.
3. `pnpm audit --audit-level high` stays clean. Fix by upgrading, never by ignoring, unless no patched version exists and the owner approves one advisory id with reason and expiry next to the entry.
4. pnpm build scripts are allow-listed in `pnpm-workspace.yaml`; approve only what needs it.

## 7 · Git and PRs

- Branch: `feat/AIV-<phase>-<nnn>-<slug>` (or `chore/…`, `fix/…`). One ticket per PR where possible.
- Commit message: what and why, with the ticket key (`AIV-P0-002: add migration runner`). The commit-msg hook rejects a message without a key.
- PR body follows `.github/pull_request_template.md`: ticket, what changed, how verified, what is not done and which ticket covers it.
- `main` is protected. Merge only with green CI, squash, on the owner's word.

### 7.0 · Code review on every push

Every pull request is reviewed twice, and again after every push that changes code:

1. **GitHub Copilot code review** runs automatically on every PR and every push, on every branch, drafts included (repository ruleset "Copilot code review on every PR and push"). Its instructions are `.github/copilot-instructions.md`: this rulebook, the ticket's Gherkin, and the Ponytail discipline.
2. **The `code-reviewer` agent** (`.claude/agents/code-reviewer.md`) reviews the PR against AGENTS.md, the ticket's Gherkin and the Ponytail discipline before the PR moves to "In review", and again after each push that changes code. It changes nothing; the author fixes.
3. **Every finding is resolved before merge:** fixed in the layer that owns it (7.1), or answered on the PR with the reason it stands. Blockers are never answered away.

### 7.1 · Stacked PRs (dependent tickets, parallel agents)

When a ticket depends on another ticket that is not merged yet, do not wait and do not fold both into one PR: **stack it**. Use GitHub's official `gh stack` extension (`gh extension install github/gh-stack`; agents also `gh skill install github/gh-stack`). Runbook: [`docs/runbooks/parallel-agents.md`](docs/runbooks/parallel-agents.md#stacked-prs).

1. **One ticket per layer.** Each layer is one branch and one PR whose base is the branch below it; the bottom PR targets `main`. Reviewers see only that layer's diff. Keep a stack to at most 4 open layers.
2. **Stack only what depends.** Tickets whose "Depends on" field names an unmerged ticket go on top of it. Independent tickets start their own stack (or a plain PR) from `main` in their own worktree, so parallel agents never wait on each other.
3. **Every layer stands alone:** its own ticket key, its own Gherkin scenarios met, green CI on its own PR, and a `Stack:` line in its PR body (`#4 → **#181** → #2xx`).
4. **Fix in the layer that owns the change**, then restack: `gh stack rebase` and `gh stack push` (force-with-lease on stack branches only; never `main`). Never patch a lower layer's bug in a higher layer.
5. **Merge bottom-up, by the owner only:** `gh stack merge <pr> --squash` merges every layer up to that PR in one all-or-nothing step and cannot bypass required checks. After a merge, `gh stack sync` rebases the rest onto `main`.
6. **Ownership:** one agent owns a stack's mutations at a time (`gh stack` serialises them per clone). Another agent may add a layer on top only after the stack's owner has pushed, and says so on the ticket.

## 8 · Where things are

| Need                                    | Look in                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| What to build, acceptance criteria      | GitHub issues and [Project 2](https://github.com/users/ALFRED-LUCIFER/projects/2) |
| Who Aivera is for, principles, surfaces | [PRODUCT.md](PRODUCT.md), [`docs/00-product/`](docs/00-product/)                  |
| Design system and screen rules          | [DESIGN.md](DESIGN.md), [`docs/01-design/`](docs/01-design/)                      |
| User journeys J0–J7                     | [`docs/01-design/journeys.md`](docs/01-design/journeys.md)                        |
| Modules and how they talk               | [`docs/02-architecture/modules.md`](docs/02-architecture/modules.md)              |
| Decisions                               | [`docs/adr/`](docs/adr/)                                                          |
| Working practice, local setup           | [`docs/runbooks/`](docs/runbooks/)                                                |

## 9 · Repository layout ([ADR-002](docs/adr/ADR-002-repository-layout.md))

1. **Keep the top-level folders:** `apps/`, `modules/`, `packages/`, `tests/`, `tools/`, `infra/`, `docs/`. The tree and what is built versus planned are in the README ("Repository structure"); update it in the same PR when you add a folder.
2. **No empty scaffolding.** A planned module, app or package is created by the ticket that builds it.
3. **Apps are composition only.** `apps/web/src/app` and `apps/worker` wire modules together; business rules live in modules or in a feature's `domain/`.
4. **No package imports an app, and no module imports an app or `packages/ui`.** Tokens, UI, i18n, db and config are shared; screens are not.
5. **One shared base config** for TypeScript, oxlint and Vitest in `packages/config`; every package extends it, so a new rule lands everywhere at once.
6. Relative Markdown links must resolve (`node tools/check-links/check.mjs`).
