#!/bin/sh
# PreToolUse guard (Bash, Edit, Write): blocks what AGENTS.md and CLAUDE.md forbid. Exit 2 = blocked, reason on stderr.
input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty')

block() { echo "Blocked by .claude/hooks/guard.sh: $1" >&2; exit 2; }

case "$tool" in
  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
    case "$cmd" in *--no-verify*) block "never bypass hooks with --no-verify (AGENTS.md 5)." ;; esac
    case "$cmd" in *"gh pr merge"*--admin*) block "never merge with --admin (CLAUDE.md 5)." ;; esac
    case "$cmd" in *"drizzle-kit push"*) block "drizzle-kit push is for a throwaway local database only; generate a migration instead (ADR-004)." ;; esac
    if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push' \
      && printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])(--force(-with-lease)?|-f)([[:space:]=]|$)|[[:space:]]\+[A-Za-z]' \
      && printf '%s' "$cmd" | grep -Eq '(^|[[:space:]:/+])main([[:space:]]|$)'; then
      block "never force-push main (AGENTS.md 5)."
    fi
    if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+commit'; then
      dir=$(printf '%s' "$input" | jq -r '.cwd // empty')
      branch=$(git -C "${dir:-.}" branch --show-current 2>/dev/null)
      [ "$branch" = "main" ] && block "do not commit on main; create a branch first (AGENTS.md 7)."
    fi
    ;;
  Edit|Write|MultiEdit)
    path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
    case "$path" in
      */.env|*/.env.local|*/.env.*.local) block "secrets never go in the repository; use Key Vault or an untracked .env.local by hand (AGENTS.md 1.11)." ;;
      */migrations/*.sql)
        # Forward-only (ADR-004): a committed migration may already be applied, so it is never edited. A new,
        # uncommitted one (e.g. a drizzle-kit --custom file) may be filled in.
        if [ -f "$path" ] && git -C "$(dirname "$path")" ls-files --error-unmatch "$path" >/dev/null 2>&1; then
          block "never edit a committed migration; generate a new one with pnpm db:generate (ADR-004)."
        fi
        ;;
    esac
    ;;
esac
exit 0
