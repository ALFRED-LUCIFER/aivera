# Aivera infrastructure (Bicep)

The dev environment lives inside Medvya's dev resource group `rg-medvya-dev-in` (Subscription 1, Central India) and holds synthetic data only ([ADR-008](../docs/adr/ADR-008-dev-environment-shares-medvya-dev.md)). Pilot and production are separate, in UAE North, and come with the launch epic AIV-P5-E03 (#34).

`main.bicep` is deployed at resource-group scope. Modules live in `modules/`, one per ticket.

## Shared (Medvya's, referenced with `existing`, never changed)

| Resource                | Name                    | Used for                      |
| ----------------------- | ----------------------- | ----------------------------- |
| Log Analytics workspace | `log-medvya-dev-3afs7i` | Aivera's Application Insights |

## Aivera's own

| Resource                 | Name                      | Ticket     | Notes                                                                                        |
| ------------------------ | ------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| Managed identity (apps)  | `id-aivera-dev`           | AIV-P0-003 | Web and worker. Key Vault Secrets User on Aivera's vault; PostgreSQL role `aivera_app`       |
| Managed identity (CI/CD) | `id-aivera-cicd-dev`      | AIV-P0-003 | GitHub Actions OIDC (`repo:ALFRED-LUCIFER/aivera:ref:refs/heads/main`) and the migration job |
| Key Vault                | `kv-aivera-dev-<6 chars>` | AIV-P0-003 | RBAC, soft delete 7 days, purge protection. Holds the App Insights connection string         |
| Application Insights     | `appi-aivera-dev`         | AIV-P0-003 | Workspace-based, on Medvya's Log Analytics workspace                                         |

Every Aivera resource is tagged `product=aivera`, `env=dev`, `data=synthetic`.

**Own Key Vault rather than an `aivera-` prefix in `kv-medvya-dev-3afs7i`:** a vault boundary keeps Aivera's identity scoped to Aivera's secrets with one role assignment, and a vault costs about $0 at dev volumes.

**Two identities rather than one:** PostgreSQL maps one Entra identity to one role, and the server has password sign-in off. With one identity the web app could sign in as the migrator, run DDL and switch row-level security off (AGENTS.md 1.4). The CI/CD identity also carries the GitHub federated credential, so a compromised web app cannot deploy.

## Monthly cost (dev, Central India, list prices November 2026)

| Resource               | Tier                        | Estimate | Why                                                                        |
| ---------------------- | --------------------------- | -------- | -------------------------------------------------------------------------- |
| Managed identities (2) | —                           | $0       | Free                                                                       |
| Key Vault              | Standard, pay per operation | < $0.05  | $0.03 per 10,000 operations                                                |
| Application Insights   | Workspace-based             | $0       | Ingestion counts against the shared workspace's 1 GB/day cap and free 5 GB |

## Apply (owner only)

Agents never apply infrastructure (CLAUDE.md 7). Sign in with MFA first: `az login`, then `az account set -s "Subscription 1"`.

```sh
az deployment group what-if -g rg-medvya-dev-in -n aivera-dev --mode Incremental -f infra/main.bicep
az deployment group create  -g rg-medvya-dev-in -n aivera-dev --mode Incremental -f infra/main.bicep
```

Always `--mode Incremental` (the default, written out on purpose): the resource group is Medvya's, and Complete mode would delete every Medvya resource the template does not declare. A second `create` with the same parameters changes nothing (the what-if shows no changes).

CI builds and lints the Bicep on every pull request (`pr.yml`, step `bicep`); any linter warning fails it.
