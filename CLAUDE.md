# Claude Code instructions for Aivera

@AGENTS.md

## Current priority: one job end to end, recruiter side

**Before anything else, one job must work end to end for a pilot recruiter:** create a workspace, add a job and get its rubric approved, take in applications, collect and assess evidence, see the ranking and a candidate's evidence profile, request missing evidence, run a Round 1 scorecard, and record a decision in the decision pack. It must work on the Azure dev environment in UAE North (real database, real Entra sign-in), not only locally.

Rank every task by whether it moves a pilot recruiter closer to that flow safely. The candidate site and Plus come after the pilot gate.

## Claude-specific rules

1. **Use the Ponytail skill (`ponytail:ponytail`, level `full`) for every development task**: writing, fixing, refactoring, reviewing and choosing dependencies. Invoke it at the start of the task.
2. For a review of a change, use `ponytail:ponytail-review` or the `code-reviewer` agent (`.claude/agents/code-reviewer.md`). For a whole-repo pass, use `ponytail:ponytail-audit`. To list recorded shortcuts, use `ponytail:ponytail-debt`.
3. To write or split tickets, use the `ticket-writer` agent (`.claude/agents/ticket-writer.md`). Every ticket has Gherkin acceptance criteria.
4. End every development reply with one or two lines saying what was skipped or not checked, and any risk the user must know.
5. **Merging.** Agents get a PR green and report; they merge only on the owner's explicit word, with `gh pr merge --auto --squash` for a single PR or `gh stack merge <pr> --squash` for a stack (never `--admin`). Before merging, update the branch onto `main` if `main` moved since the PR's last green run. Never merge red or unfinished CI. When `main` is red, fixing it comes before any other merge. Dependent tickets are stacked PRs (AGENTS.md 7.1); run `gh stack view` before starting work to see open stacks.
6. **Ticket status** is on the GitHub issue and the Project 2 board (AGENTS.md 2.1): update both when work starts and when it finishes.
7. Local notes: Node 24 LTS (`.nvmrc`), pnpm 11. Shell is zsh: `status` is a read-only variable, macOS `sed -i ''`, a tool call that starts with `sleep` is blocked (wait with a background `until` loop). Infrastructure applies, Key Vault writes, Entra tenant settings and anything named prod are the owner's.
