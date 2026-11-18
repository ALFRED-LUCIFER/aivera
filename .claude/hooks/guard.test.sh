#!/bin/sh
# Self-check for guard.sh: each forbidden input must exit 2, each allowed one 0. Run: sh .claude/hooks/guard.test.sh
here=$(dirname "$0")
fail=0
tmp=$(mktemp -d)
git -C "$tmp" init -q -b main

expect() { # expect <code> <description> <json>
  printf '%s' "$3" | sh "$here/guard.sh" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$1" ]; then echo "ok   $2"; else echo "FAIL $2 (expected $1, got $got)"; fail=1; fi
}

# SAFETY: mutation check: removed the commit-on-main block in guard.sh -> "commit on main" failed (expected 2, got 0)
expect 2 "commit on main" "{\"tool_name\":\"Bash\",\"cwd\":\"$tmp\",\"tool_input\":{\"command\":\"git commit -m x\"}}"
expect 2 "--no-verify" '{"tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m x"}}'
expect 2 "force-push main" '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}'
expect 2 "plus-refspec push to main" '{"tool_name":"Bash","tool_input":{"command":"git push origin +HEAD:main"}}'
expect 2 "admin merge" '{"tool_name":"Bash","tool_input":{"command":"gh pr merge 4 --admin --squash"}}'
expect 2 "drizzle-kit push" '{"tool_name":"Bash","tool_input":{"command":"pnpm drizzle-kit push"}}'
expect 2 "write .env.local" '{"tool_name":"Write","tool_input":{"file_path":"/x/.env.local"}}'
existing="$tmp/migrations/0000_init.sql"; mkdir -p "$tmp/migrations"; : > "$existing"; git -C "$tmp" add "$existing"
expect 2 "edit committed migration" "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$existing\"}}"
draft="$tmp/migrations/0001_custom.sql"; : > "$draft"
expect 0 "fill an uncommitted custom migration" "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$draft\"}}"
expect 0 "new migration file" "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$tmp/migrations/0001_new.sql\"}}"
expect 0 "normal push of a branch" '{"tool_name":"Bash","tool_input":{"command":"git push -u origin feat/AIV-P0-002-x"}}'
# Its own repository on a feature branch: the real checkout is main on push builds of main, where the guard rightly blocks.
branch=$(mktemp -d); git -C "$branch" init -q -b feat/AIV-P0-001-x
expect 0 "commit on a branch" "{\"tool_name\":\"Bash\",\"cwd\":\"$branch\",\"tool_input\":{\"command\":\"git commit -m 'AIV-P0-001: x'\"}}"
rm -rf "$branch"
expect 0 "write a source file" '{"tool_name":"Write","tool_input":{"file_path":"/x/src/a.ts"}}'

rm -rf "$tmp"
exit $fail
