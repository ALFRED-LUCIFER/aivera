#!/bin/sh
# Set Project 2 fields for issues (AGENTS.md 2.1, CLAUDE.md 6: the board Status is the source of ticket status).
# Usage: sh tools/board/status.sh <Status> <issue> [<issue>...]      Status: Todo | "In progress" | "In review" | Done
#        FIELD="Depends on" TEXT="AIV-P1-051" sh tools/board/status.sh - <issue>...   (set a text field instead)
set -eu
owner=ALFRED-LUCIFER project=2 project_id=PVT_kwHOBbb8PM4BsJF9
status=$1; shift
fields=$(gh project field-list $project --owner $owner --format json)
items=$(gh project item-list $project --owner $owner --format json --limit 1000 --jq '.items[]|[.content.number,.id]|@tsv')
for n in "$@"; do
  item=$(printf '%s\n' "$items" | awk -F'\t' -v n="$n" '$1==n{print $2}')
  [ -n "$item" ] || item=$(gh project item-add $project --owner $owner --url "https://github.com/$owner/aivera/issues/$n" --format json --jq .id)
  if [ "$status" = "-" ]; then
    fid=$(printf '%s' "$fields" | jq -r --arg f "$FIELD" '.fields[]|select(.name==$f).id')
    gh project item-edit --project-id $project_id --id "$item" --field-id "$fid" --text "$TEXT" >/dev/null
    echo "#$n $FIELD = $TEXT"
  else
    fid=$(printf '%s' "$fields" | jq -r '.fields[]|select(.name=="Status").id')
    oid=$(printf '%s' "$fields" | jq -r --arg s "$status" '.fields[]|select(.name=="Status").options[]|select(.name==$s).id')
    gh project item-edit --project-id $project_id --id "$item" --field-id "$fid" --single-select-option-id "$oid" >/dev/null
    echo "#$n Status = $status"
  fi
done
