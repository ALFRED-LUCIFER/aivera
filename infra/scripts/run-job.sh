#!/bin/sh
# Starts one execution of a Container Apps job in rg-medvya-dev-in and waits for it; exits non-zero unless it succeeds.
# Usage: sh infra/scripts/run-job.sh <job> [execution-template.json]   (the template replaces the job's containers)
set -eu
rg=rg-medvya-dev-in
job=$1
execution=$(az containerapp job start -g $rg -n "$job" ${2:+--yaml "$2"} --query name -o tsv)
echo "Started $job execution $execution"
until s=$(az containerapp job execution show -g $rg -n "$job" --job-execution-name "$execution" \
  --query properties.status -o tsv) && [ "$s" != Running ] && [ "$s" != Processing ]; do sleep 5; done
echo "$job execution $execution: $s (logs: Log Analytics, ContainerAppConsoleLogs_CL)"
[ "$s" = Succeeded ]
