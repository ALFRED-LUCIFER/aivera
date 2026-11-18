#!/bin/sh
# One-off, owner only (AIV-P0-004): creates Aivera's database roles on the shared Medvya dev server from inside the
# VNet. It borrows one execution of job-aivera-migrate-dev with a psql container and the owner's own Entra token
# (the owner is a server Entra admin), so no Aivera identity ever becomes a server admin. Run after
# `az deployment group create` (infra/README.md).
# The token never appears in the execution template: it is a job secret (write-only in ARM, referenced by secretRef)
# that the trap removes as soon as the execution ends, success or not.
# shortcut: while the execution runs (about a minute) a principal with listSecrets on the job (the owner, and the CI/CD identity's Contributor) could read the token, which expires within about an hour; acceptable for a one-off dev bootstrap, revisit if this ever runs in pilot or production
set -eu
rg=rg-medvya-dev-in
job=job-aivera-migrate-dev
here=$(dirname "$0")

app_oid=$(az identity show -g $rg -n id-aivera-dev --query principalId -o tsv)
cicd_oid=$(az identity show -g $rg -n id-aivera-cicd-dev --query principalId -o tsv)
admin=$(az ad signed-in-user show --query userPrincipalName -o tsv)
host=$(az postgres flexible-server show -g $rg -n psql-medvya-dev-3afs7i --query fullyQualifiedDomainName -o tsv)

template=$(mktemp)
cleanup() {
  rm -f "$template"
  az containerapp job secret remove -g $rg -n $job --secret-names bootstrap-pg-token -o none 2>/dev/null || true
}
trap cleanup EXIT INT TERM
az containerapp job secret set -g $rg -n $job -o none \
  --secrets "bootstrap-pg-token=$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)"

# A job execution template (JSON is valid YAML for --yaml): the SQL travels as an environment variable.
jq -n --arg sql "$(cat "$here/../sql/bootstrap-roles.sql")" --arg host "$host" --arg user "$admin" \
  --arg app "$app_oid" --arg cicd "$cicd_oid" '{containers: [{
    name: "bootstrap", image: "postgres:16-alpine",
    command: ["sh", "-c", "printf %s \"$SQL\" | psql -v ON_ERROR_STOP=1 -v app_oid=\"$APP_OID\" -v cicd_oid=\"$CICD_OID\""],
    env: [
      {name: "SQL", value: $sql}, {name: "APP_OID", value: $app}, {name: "CICD_OID", value: $cicd},
      {name: "PGHOST", value: $host}, {name: "PGUSER", value: $user}, {name: "PGDATABASE", value: "postgres"},
      {name: "PGSSLMODE", value: "verify-full"}, {name: "PGSSLROOTCERT", value: "system"},
      {name: "PGPASSWORD", secretRef: "bootstrap-pg-token"}
    ],
    resources: {cpu: 0.25, memory: "0.5Gi"}
  }]}' > "$template"

sh "$here/run-job.sh" $job "$template"
echo "The role check output is in Log Analytics (ContainerAppConsoleLogs_CL) for that execution."
