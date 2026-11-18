# Running several agents in parallel

Several Claude Code sessions (or people) can work on different tickets at once. These rules keep them from breaking each other.

1. **One ticket, one branch, one worktree.** `git worktree add ../aivera-AIV-P1-013 -b feat/AIV-P1-013-<slug> origin/main`. Never two agents in one checkout.
2. **Pick tickets whose files do not overlap.** Two tickets that touch the same module's migrations, the same feature folder, or `packages/ui` run one after the other. Check the "Depends on" field on Project 2.
3. **Migrations are serialised per module.** Only one open PR per module may add a migration. If `main` gained a migration for your module, rebase and regenerate yours (`pnpm db:generate`) before merging.
4. **Shared services from one checkout only.** Start PostgreSQL (`pnpm services:up`, from AIV-P0-002) once; other worktrees connect to it with their own database name. Integration tests use Testcontainers and need no shared database.
5. **One agent drives the browser.** The Playwright browser is shared; one call at a time, never a screenshot batched with a navigation. Dev servers use a port per worktree (`PORT=3001 pnpm --filter web dev`); check with `lsof -iTCP:<port>` before trusting a result.
6. **Never** restart Docker, prune volumes, force-push or merge on a shared machine without the owner.
7. **Report status on GitHub**: `status:` label, a comment, and the Project 2 Status, at start and finish (AGENTS.md 2.1).
