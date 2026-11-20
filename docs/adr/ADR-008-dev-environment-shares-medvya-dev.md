# ADR-008: Dev environment shares Medvya dev in Central India

- **Status:** Accepted, 18 Nov 2026
- **Ticket:** AIV-P0-003 (epic AIV-P0-E02)

## Context

AGENTS.md 1.10 and ADR-001 put every Credalent resource in UAE North. Epic AIV-P0-E02 asked for a full dev environment there: its own resource group, PostgreSQL server, VNet, Container Apps environment, registry, Front Door, Log Analytics and Key Vault. Before any pilot that costs tens of dollars a month for an environment that holds no real data.

The owner already runs Medvya's dev environment in subscription "Subscription 1", resource group `rg-medvya-dev-in`, Central India: a Burstable B1ms PostgreSQL 16 server with private access only and Entra authentication only, a VNet, an internal Container Apps environment and a Log Analytics workspace. The owner's dev cost rule (18 Nov 2026) is free or cheapest dev tiers and minimal resources.

## Decision

Credalent's **dev** environment shares Medvya's dev environment in Central India. Credalent creates only what it must own and references the rest with Bicep `existing` (`infra/`, `infra/README.md`).

1. **Synthetic data only.** Dev holds the synthetic cast from `docs/00-product/personas.md` and nothing else (AGENTS.md 1.1). No real candidate, recruiter or client data ever reaches dev, so data residency is not engaged.
2. **Pilot and production are in UAE North.** Each gets its own resource group, PostgreSQL server, network, Key Vault and identities there, as AGENTS.md 1.10 requires (launch epic AIV-P5-E03, #34). Nothing in dev is promoted or replicated to them.
3. **Medvya and Credalent stay isolated:**
   - **Database:** a separate `aivera` database on the shared server; `CONNECT` on it is revoked from `PUBLIC`.
   - **Roles:** Credalent's own Entra-mapped roles `aivera_migrator` and `aivera_app`. Credalent grants them nothing on any Medvya database or role, and neither is a server Entra admin. They do inherit what Medvya's databases grant to `PUBLIC`: by PostgreSQL default that includes `CONNECT` on `medvya` (and `postgres`). Revoking `CONNECT` on `medvya` from `PUBLIC` (and granting it to Medvya's own roles) is an owner and Medvya action; `infra/scripts/bootstrap-db.sh` prints which databases the Credalent roles can reach so the owner can check.
   - **Identity:** Credalent's own managed identities (`id-aivera-dev`, `id-aivera-cicd-dev`). They hold roles on Credalent's resources only, never on the resource group or on a Medvya resource; the deploy role's environment join is on Credalent's own `cae-aivera-dev`.
   - **Secrets:** Credalent's own Key Vault. Credalent's identities cannot read Medvya's vaults, and Medvya's cannot read Credalent's.
   - **No cross-database access:** no `dblink`, `postgres_fdw` or shared schemas. Shared server parameters (such as `azure.extensions`) are changed only with Medvya's agreement, and the change is recorded in the Credalent ticket that needs it.

## Consequences

- Dev costs about $0–1 a month above what Medvya already pays (estimate in `infra/README.md`).
- Dev runs PostgreSQL 16 while ADR-001 names 17. Dev migrations must stay PostgreSQL 16-compatible; pilot and production use 17.
- pgvector is not in the shared server's `azure.extensions` allow-list. AIV-P0-030 adds `VECTOR` to it (owner apply, agreed with Medvya) before the first embedding migration.
- Medvya's Container Apps environment is internal (VNet only). So that dev has a public URL, Credalent runs its own external, consumption-only environment `cae-aivera-dev` (free) on a new subnet `snet-aivera-dev` (10.20.5.0/27) of Medvya's VNet (owner decision, 18 Nov 2026). The subnet is the only thing Credalent adds inside a Medvya resource: it is declared as its own child resource, so the VNet's address space, DNS and Medvya's subnets are never redeclared or changed. The VNet-linked private DNS zone gives the new subnet private access to PostgreSQL. Front Door, a custom domain and portfolio subdomains still come with the launch epic.
- Logs and Application Insights data land in Medvya's Log Analytics workspace, which has a shared 1 GB/day ingestion cap: noisy Credalent logging can stop Medvya's logs for the rest of the day, and the reverse.
- A Medvya incident (server restart, quota, a full log cap) can take Credalent dev down too. That is acceptable for dev and never acceptable for pilot or production.
- Revisit this decision when Credalent holds any real data: that is the pilot, which is in UAE North.
