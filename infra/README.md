# Aivera infrastructure (Bicep)

The dev environment lives inside Medvya's dev resource group `rg-medvya-dev-in` (Subscription 1, Central India) and holds synthetic data only ([ADR-008](../docs/adr/ADR-008-dev-environment-shares-medvya-dev.md)). Pilot and production are separate, in UAE North, and come with the launch epic AIV-P5-E03 (#34).

`main.bicep` is deployed at resource-group scope. Modules live in `modules/`, one per ticket.

## Shared (Medvya's, referenced with `existing`, never changed)

| Resource                   | Name                     | Used for                                                                                                                 |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Log Analytics workspace    | `log-medvya-dev-3afs7i`  | Aivera's Application Insights                                                                                            |
| PostgreSQL Flexible Server | `psql-medvya-dev-3afs7i` | Burstable B1ms, PostgreSQL 16, private access only, Entra sign-in only. Aivera adds the `aivera` database                |
| Virtual network            | `vnet-medvya-dev-3afs7i` | Aivera adds one subnet (below). The VNet itself, its address space, DNS and Medvya's subnets are not declared or changed |

## Aivera's own

| Resource                   | Name                                              | Ticket     | Notes                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed identity (apps)    | `id-aivera-dev`                                   | AIV-P0-003 | Web and worker. Key Vault Secrets User on Aivera's vault; PostgreSQL role `aivera_app`                                                                                                                               |
| Managed identity (CI/CD)   | `id-aivera-cicd-dev`                              | AIV-P0-003 | GitHub Actions OIDC (`repo:ALFRED-LUCIFER/aivera:ref:refs/heads/main`) and the migration job                                                                                                                         |
| Key Vault                  | `kv-aivera-dev-<6 chars>`                         | AIV-P0-003 | RBAC, soft delete 7 days, purge protection. Holds the App Insights connection string                                                                                                                                 |
| Application Insights       | `appi-aivera-dev`                                 | AIV-P0-003 | Workspace-based, on Medvya's Log Analytics workspace                                                                                                                                                                 |
| PostgreSQL database        | `aivera` on `psql-medvya-dev-3afs7i`              | AIV-P0-004 | Roles `aivera_migrator` and `aivera_app` mapped to the two identities (`sql/bootstrap-roles.sql`); `CONNECT` revoked from `PUBLIC`                                                                                   |
| Subnet                     | `snet-aivera-dev` (10.20.5.0/27) in Medvya's VNet | AIV-P0-004 | Delegated to `Microsoft.App/environments`; declared as its own child resource, so the PUT touches only this subnet                                                                                                   |
| Container Apps environment | `cae-aivera-dev`                                  | AIV-P0-004 | External, consumption only, on `snet-aivera-dev`; logs to Medvya's workspace. Reaches PostgreSQL privately: the private DNS zone `medvya-dev-3afs7i.private.postgres.database.azure.com` is linked to the whole VNet |
| Container Apps job         | `job-aivera-migrate-dev`                          | AIV-P0-004 | In `cae-aivera-dev`. Manual trigger; runs `pnpm db:migrate` as `aivera_migrator` from inside the VNet                                                                                                                |

Every Aivera resource is tagged `product=aivera`, `env=dev`, `data=synthetic`.

**Own Key Vault rather than an `aivera-` prefix in `kv-medvya-dev-3afs7i`:** a vault boundary keeps Aivera's identity scoped to Aivera's secrets with one role assignment, and a vault costs about $0 at dev volumes.

**Two identities rather than one:** PostgreSQL maps one Entra identity to one role, and the server has password sign-in off. With one identity the web app could sign in as the migrator, run DDL and switch row-level security off (AGENTS.md 1.4). The CI/CD identity also carries the GitHub federated credential, so a compromised web app cannot deploy.

## Monthly cost (dev, Central India, list prices November 2026)

| Resource                   | Tier                          | Estimate | Why                                                                        |
| -------------------------- | ----------------------------- | -------- | -------------------------------------------------------------------------- |
| Managed identities (2)     | —                             | $0       | Free                                                                       |
| Key Vault                  | Standard, pay per operation   | < $0.05  | $0.03 per 10,000 operations                                                |
| Application Insights       | Workspace-based               | $0       | Ingestion counts against the shared workspace's 1 GB/day cap and free 5 GB |
| PostgreSQL database        | On the shared B1ms server     | $0       | No new server; storage grows by megabytes of synthetic data                |
| Container Apps environment | Consumption only              | $0       | No charge for a consumption-only environment; apps and jobs pay per use    |
| Subnet                     | —                             | $0       | Free                                                                       |
| Migration job              | Consumption, 0.5 vCPU / 1 GiB | $0       | Under a minute per deploy, inside the monthly free grant                   |

## Apply (owner only)

Agents never apply infrastructure (CLAUDE.md 7). Sign in with MFA first: `az login`, then `az account set -s "Subscription 1"`.

```sh
az deployment group what-if -g rg-medvya-dev-in -n aivera-dev --mode Incremental -f infra/main.bicep -p imageTag=<sha>
az deployment group create  -g rg-medvya-dev-in -n aivera-dev --mode Incremental -f infra/main.bicep -p imageTag=<sha>
```

Always `--mode Incremental` (the default, written out on purpose): the resource group is Medvya's, and Complete mode would delete every Medvya resource the template does not declare.

`imageTag` is the commit SHA of images already pushed to ghcr.io by `deploy-dev.yml`. On a later run, pass the tag running now so nothing moves: `az containerapp job show -g rg-medvya-dev-in -n job-aivera-migrate-dev --query 'properties.template.containers[0].image' -o tsv`. A second `create` with the same parameters changes nothing (the what-if shows no changes).

### Database roles (once, after the first `create`)

The server has password sign-in off and no public access, so the roles are created from inside the VNet by a server Entra admin (the owner):

```sh
sh infra/scripts/bootstrap-db.sh
```

It borrows one execution of `job-aivera-migrate-dev` with a `postgres:16-alpine` container and the owner's own short-lived Entra token (held in a job secret for the length of the execution and removed when it ends, never in the execution template), connects with `sslmode=verify-full`, runs `infra/sql/bootstrap-roles.sql`, and prints each role's flags and the databases it can connect to. Expect `rolsuper`, `rolbypassrls` and `rolcreaterole` false. If `can_connect_to` lists `medvya`, Medvya's database still grants `CONNECT` to `PUBLIC`: agree with Medvya to revoke it (ADR-008). Rerunning is safe.

The roles are mapped to the identities' object ids. If `id-aivera-dev` or `id-aivera-cicd-dev` is ever deleted and recreated, its new object id no longer matches: drop the stale role (`DROP ROLE aivera_app` after reassigning what it owns) and rerun the script.

### pgvector (AIV-P0-030, not now)

The shared server's `azure.extensions` allows `PGCRYPTO,PG_STAT_STATEMENTS,PGAUDIT,PG_TRGM`. Before the first migration that needs `vector`, the owner adds it, keeping Medvya's entries (it is a dynamic parameter, no restart):

```sh
az postgres flexible-server parameter set -g rg-medvya-dev-in -s psql-medvya-dev-3afs7i \
  -n azure.extensions -v PGCRYPTO,PG_STAT_STATEMENTS,PGAUDIT,PG_TRGM,VECTOR
```

### Medvya's VNet and the new subnet

The subnet is the only change inside a Medvya resource. If Medvya's own infrastructure code ever redeploys `vnet-medvya-dev-3afs7i` with its subnets declared inline, that deployment would try to remove `snet-aivera-dev` (and fail while the environment uses it). Tell Medvya to declare its subnets as child resources, or to add `snet-aivera-dev` to its template.

CI builds and lints the Bicep on every pull request (`pr.yml`, step `bicep`); any linter warning fails it.
