#!/bin/sh
# One-off, owner only (AIV-P0-004): creates Credalent's database roles on the environment's PostgreSQL server from inside
# the VNet. It borrows one execution of job-aivera-migrate-<env> with a psql container and the owner's own Entra token
# (the owner is a server Entra admin), so no Credalent identity ever becomes a server admin. Run after
# `az deployment group create` (infra/README.md, docs/runbooks/pilot-environment.md).
# Usage: sh infra/scripts/bootstrap-db.sh <resource group> <env> <postgres server>
#   dev:   sh infra/scripts/bootstrap-db.sh rg-medvya-dev-in dev psql-medvya-dev-3afs7i
#   pilot: the server name is the deployment's postgresServerName output.
# The token never appears in the execution template: it is a job secret (write-only in ARM, referenced by secretRef)
# that the trap removes as soon as the execution ends, success or not.
# shortcut: while the execution runs (about a minute) a principal with listSecrets on the job (the owner, and the CI/CD identity's Contributor) could read the token, which expires within about an hour; accepted for the one-off dev and pilot bootstraps (the pilot's CI/CD identity signs in only from owner-approved runs), revisit before production
set -eu
[ $# -eq 3 ] || { echo "Usage: sh infra/scripts/bootstrap-db.sh <resource group> <env> <postgres server>" >&2; exit 2; }
rg=$1
env=$2
server=$3
job=job-aivera-migrate-$env
here=$(dirname "$0")

app_oid=$(az identity show -g "$rg" -n "id-aivera-$env" --query principalId -o tsv)
cicd_oid=$(az identity show -g "$rg" -n "id-aivera-cicd-$env" --query principalId -o tsv)
relay_oid=$(az identity show -g "$rg" -n "id-aivera-relay-$env" --query principalId -o tsv)
# The server knows its Entra admins by their registered principal name, which for a guest (#EXT#) account differs
# from the UPN, so look it up by the signed-in user's object id.
me=$(az ad signed-in-user show --query id -o tsv)
admin=$(az postgres flexible-server microsoft-entra-admin list -g "$rg" -s "$server" --query "[?objectId=='$me'].principalName | [0]" -o tsv)
[ -n "$admin" ] || { echo "The signed-in user is not a Microsoft Entra admin on $server." >&2; exit 1; }
host=$(az postgres flexible-server show -g "$rg" -n "$server" --query fullyQualifiedDomainName -o tsv)

template=$(mktemp)
cleanup() {
  rm -f "$template"
  # --yes: without it the command waits for a confirmation the trap can never give, and the token stays on the job.
  az containerapp job secret remove -g "$rg" -n "$job" --secret-names bootstrap-pg-token --yes -o none \
    || echo "WARNING: remove the job secret bootstrap-pg-token by hand (az containerapp job secret remove ... --yes)" >&2
}
trap cleanup EXIT INT TERM
az containerapp job secret set -g "$rg" -n "$job" -o none \
  --secrets "bootstrap-pg-token=$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)"

# A job execution template (JSON is valid YAML for --yaml): the SQL travels as an environment variable.
jq -n --arg sql "$(cat "$here/../sql/bootstrap-roles.sql")" --arg host "$host" --arg user "$admin" \
  --arg app "$app_oid" --arg cicd "$cicd_oid" --arg relay "$relay_oid" '{containers: [{
    name: "bootstrap", image: "postgres:16-alpine",
    command: ["sh", "-c", "printf %s \"$SQL\" | psql -v ON_ERROR_STOP=1 -v app_oid=\"$APP_OID\" -v cicd_oid=\"$CICD_OID\" -v relay_oid=\"$RELAY_OID\""],
    env: [
      {name: "SQL", value: $sql}, {name: "APP_OID", value: $app}, {name: "CICD_OID", value: $cicd}, {name: "RELAY_OID", value: $relay},
      {name: "PGHOST", value: $host}, {name: "PGUSER", value: $user}, {name: "PGDATABASE", value: "postgres"},
      {name: "PGSSLMODE", value: "verify-full"}, {name: "PGSSLROOTCERT", value: "system"},
      {name: "PGPASSWORD", secretRef: "bootstrap-pg-token"}
    ],
    resources: {cpu: 0.25, memory: "0.5Gi"}
  }]}' > "$template"

RG=$rg sh "$here/run-job.sh" "$job" "$template"
echo "The role check output is in Log Analytics (ContainerAppConsoleLogs_CL) for that execution."
