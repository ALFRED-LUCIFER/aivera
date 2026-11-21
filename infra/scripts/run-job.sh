#!/bin/sh
# Starts one execution of a Container Apps job in resource group $RG and waits for it; exits non-zero unless it succeeds.
# Usage: RG=<resource group> sh infra/scripts/run-job.sh <job> [execution-template.json]   (the template replaces the job's containers)
# The deploy workflows set RG in their env block (deploy-dev.yml, deploy-pilot.yml).
set -eu
rg=${RG:?set RG to the resource group of the job}
job=$1
execution=$(az containerapp job start -g "$rg" -n "$job" ${2:+--yaml "$2"} --query name -o tsv)
echo "Started $job execution $execution"
# Wait for a final state. Right after start the status is "Unknown" (and briefly empty), so only these end the wait.
n=0
while :; do
  s=$(az containerapp job execution show -g "$rg" -n "$job" --job-execution-name "$execution" --query properties.status -o tsv || true)
  case "$s" in Succeeded|Failed|Stopped|Degraded) break ;; esac
  n=$((n + 1)); [ $n -gt 180 ] && { echo "$job execution $execution: still '$s' after 15 minutes" >&2; exit 1; }
  sleep 5
done
echo "$job execution $execution: $s (logs: Log Analytics, ContainerAppConsoleLogs_CL)"
[ "$s" = Succeeded ]
