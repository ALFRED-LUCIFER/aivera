#!/bin/sh
# One-off, owner only (AIV-P0-004): creates Aivera's database roles on the shared Medvya dev server from inside the
# VNet. It borrows one execution of job-aivera-migrate-dev with a psql container and the owner's own Entra token
# (the owner is a server Entra admin), so no Aivera identity ever becomes a server admin. Run after
# `az deployment group create` (infra/README.md). The token expires within about an hour.
set -eu
rg=rg-medvya-dev-in
here=$(dirname "$0")

app_oid=$(az identity show -g $rg -n id-aivera-dev --query principalId -o tsv)
cicd_oid=$(az identity show -g $rg -n id-aivera-cicd-dev --query principalId -o tsv)
admin=$(az ad signed-in-user show --query userPrincipalName -o tsv)
host=$(az postgres flexible-server show -g $rg -n psql-medvya-dev-3afs7i --query fullyQualifiedDomainName -o tsv)
token=$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)

template=$(mktemp)
trap 'rm -f "$template"' EXIT
# A job execution template (JSON is valid YAML for --yaml): the SQL travels as an environment variable.
jq -n --arg sql "$(cat "$here/../sql/bootstrap-roles.sql")" --arg host "$host" --arg user "$admin" \
  --arg token "$token" --arg app "$app_oid" --arg cicd "$cicd_oid" '{containers: [{
    name: "bootstrap", image: "postgres:16-alpine",
    command: ["sh", "-c", "printf %s \"$SQL\" | psql -v ON_ERROR_STOP=1 -v app_oid=\"$APP_OID\" -v cicd_oid=\"$CICD_OID\""],
    env: [
      {name: "SQL", value: $sql}, {name: "APP_OID", value: $app}, {name: "CICD_OID", value: $cicd},
      {name: "PGHOST", value: $host}, {name: "PGUSER", value: $user}, {name: "PGDATABASE", value: "postgres"},
      {name: "PGSSLMODE", value: "require"}, {name: "PGPASSWORD", value: $token}
    ],
    resources: {cpu: 0.25, memory: "0.5Gi"}
  }]}' > "$template"

sh "$here/run-job.sh" job-aivera-migrate-dev "$template"
echo "The role check output is in Log Analytics (ContainerAppConsoleLogs_CL) for that execution."
