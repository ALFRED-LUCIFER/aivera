# Running several agents in parallel

Several Claude Code sessions (or people) can work on different tickets at once. These rules keep them from breaking each other.

1. **One ticket, one branch, one worktree.** `git worktree add ../credalent-AIV-P1-013 -b feat/AIV-P1-013-<slug> origin/main`. Never two agents in one checkout.
2. **Pick tickets whose files do not overlap.** Two tickets that touch the same module's migrations, the same feature folder, or `packages/ui` run one after the other, or as a stack (below). Check the "Depends on" field on Project 2.
3. **Migrations are serialised per module.** Only one open PR per module may add a migration. If `main` gained a migration for your module, rebase and regenerate yours (`pnpm db:generate`) before merging.
4. **Shared services from one checkout only.** Start PostgreSQL (`pnpm services:up`, from AIV-P0-002) once; other worktrees connect to it with their own database name. Integration tests use Testcontainers and need no shared database.
5. **One agent drives the browser.** The Playwright browser is shared; one call at a time, never a screenshot batched with a navigation. Dev servers use a port per worktree (`PORT=3001 pnpm --filter web dev`); check with `lsof -iTCP:<port>` before trusting a result.
6. **Never** restart Docker, prune volumes, merge, or force-push anything but your own stack branch (`--force-with-lease`, AGENTS.md 7.1) without the owner. `main` is never force-pushed.
7. **Report status on GitHub**: `status:` label, a comment, and the Project 2 Status, at start and finish (AGENTS.md 2.1).
8. **Share the GitHub API limit.** Every agent on the account draws on one 5,000-an-hour budget; a 30-second `gh pr checks` loop plus a few agents exhausted it in under an hour (27 Nov 2026). Poll every 2 minutes or more, and only one loop per PR.
9. **A red CI job is a fault until a rerun says otherwise.** Read the failure first. Rerun only the failed job or shard (`gh run rerun <run-id> --failed`), once, when the failure matches a known flake in [local-development.md](local-development.md#known-quirks-found-by-agents-nov-2026) or a one-off AI eval miss; a second failure is a real fault to fix, and every rerun is named in the PR or issue comment.

## Stacked PRs

Rule: AGENTS.md 7.1. Tool: GitHub's official [`gh stack`](https://github.com/github/gh-stack) extension.

```text
feat/AIV-P1-004-rubric-approval  → PR (base: feat/AIV-P1-003-rubric)   ← top
feat/AIV-P1-003-rubric           → PR (base: feat/AIV-P1-002-add-job)
feat/AIV-P1-002-add-job          → PR (base: main)                      ← bottom
main
```

| Step                                                  | Command                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Once per machine                                      | `gh extension install github/gh-stack` (agents: `gh skill install github/gh-stack`) |
| See open stacks before picking a ticket               | `gh stack view` / `gh stack checkout`                                               |
| Start a stack from `main`, or adopt existing branches | `gh stack init feat/AIV-P1-002-add-job` / `gh stack init <bottom> <next> …`         |
| Add the dependent ticket on top                       | `gh stack add feat/AIV-P1-003-rubric`                                               |
| Open or update all PRs with the right bases           | `gh stack submit`                                                                   |
| A lower layer changed (review fix)                    | commit on that layer, then `gh stack rebase` and `gh stack push`                    |
| `main` moved or a layer merged                        | `gh stack sync`                                                                     |
| Owner merges bottom-up                                | `gh stack merge <pr> --squash`                                                      |

Stack branches can live in different worktrees: `gh stack rebase` and `sync` update each clean worktree that owns a branch and stop if one is dirty. Keep the affected worktrees idle while a stack is rebased.

Without the extension the same shape works by hand: branch from the layer below, `gh pr create --base <layer below>`, and after a lower layer changes, `git rebase <layer below>` then `git push --force-with-lease` on your own stack branch.
