# Claude Code instructions for Aivera

@AGENTS.md

## Current priority: one job end to end, recruiter side

**Before anything else, one job must work end to end for a pilot recruiter:** create a workspace, add a job and get its rubric approved, take in applications, collect and assess evidence, see the ranking and a candidate's evidence profile, request missing evidence, run a Round 1 scorecard, and record a decision in the decision pack. It must work on the Azure dev environment in UAE North (real database, real Entra sign-in), not only locally.

Rank every task by whether it moves a pilot recruiter closer to that flow safely. The candidate site and Plus come after the pilot gate.

## Claude-specific rules

1. **Ponytail is mandatory: invoke `ponytail:ponytail` (level `full`) before writing any code**: writing, fixing, refactoring, reviewing and choosing dependencies. No code is written outside it. The plugin is enabled for this repository in `.claude/settings.json`; if it is missing, install it (`/plugin marketplace add DietrichGebert/ponytail`, then enable `ponytail@ponytail`) before coding.
2. **Every PR gets the `code-reviewer` agent** (`.claude/agents/code-reviewer.md`) before it moves to "In review" and after each push that changes code; Copilot reviews automatically too (AGENTS.md 7.0). Resolve every finding before asking for a merge. For a quick self-check use `ponytail:ponytail-review`. For a whole-repo pass, use `ponytail:ponytail-audit`. To list recorded shortcuts, use `ponytail:ponytail-debt`.
3. To write or split tickets, use the `ticket-writer` agent (`.claude/agents/ticket-writer.md`). Every ticket has Gherkin acceptance criteria.
4. End every development reply with one or two lines saying what was skipped or not checked, and any risk the user must know.
5. **Merging.** Agents get a PR green and report; they merge only on the owner's explicit word, with `gh pr merge --auto --squash` for a single PR or `gh stack merge <pr> --squash` for a stack (never `--admin`). Before merging, update the branch onto `main` if `main` moved since the PR's last green run. Never merge red or unfinished CI. When `main` is red, fixing it comes before any other merge. Dependent tickets are stacked PRs (AGENTS.md 7.1); run `gh stack view` before starting work to see open stacks.
6. **Ticket status is the Project 2 board Status field** (Todo → In progress → In review → Done): update it when work starts, when the PR is up, and when it merges; close the issue on merge and the epic when its last ticket is Done. Labels are secondary. UI is verified by Playwright tests in CI, not by hand-driving a browser (AGENTS.md 2.8).
7. Local notes: Node 24 LTS (`.nvmrc`), pnpm 11; setup in `docs/runbooks/local-development.md`. Docker here is Colima: integration tests need `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. pnpm enforces a minimum release age: pin a version old enough rather than adding `minimumReleaseAgeExclude`. Shell is zsh: `status` is a read-only variable, macOS `sed -i ''`, a tool call that starts with `sleep` is blocked (wait with a background `until` loop). Infrastructure applies, Key Vault writes, Entra tenant settings and anything named prod are the owner's.
