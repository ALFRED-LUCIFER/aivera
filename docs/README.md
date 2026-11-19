# Aivera documentation

| Folder                                 | What is in it                                               |
| -------------------------------------- | ----------------------------------------------------------- |
| [`00-product/`](00-product/)           | Synthetic personas and demo cast                            |
| [`01-design/`](01-design/)             | User journeys J0–J7 and the screen map to the design canvas |
| [`02-architecture/`](02-architecture/) | Modules, their schemas and how they talk                    |
| [`adr/`](adr/)                         | Architecture decision records                               |
| [`runbooks/`](runbooks/)               | Working practice and local setup                            |

Rules live in [`../AGENTS.md`](../AGENTS.md); product in [`../PRODUCT.md`](../PRODUCT.md); design system in [`../DESIGN.md`](../DESIGN.md).

## Decisions

| ADR                                                         | Decision                                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-001](adr/ADR-001-technology-stack.md)                  | TypeScript end to end on Azure: Next.js 16, Node worker, PostgreSQL, Azure AI Foundry                                            |
| [ADR-002](adr/ADR-002-repository-layout.md)                 | Monorepo layout and modular monolith in TypeScript                                                                               |
| [ADR-003](adr/ADR-003-frontend-feature-layers.md)           | Front-end feature layers on the Next.js App Router                                                                               |
| [ADR-004](adr/ADR-004-database-and-migrations.md)           | PostgreSQL, Drizzle ORM, Drizzle Kit migrations, one schema per module                                                           |
| [ADR-005](adr/ADR-005-workspace-tenancy.md)                 | Workspace tenancy: repository filter and row-level security                                                                      |
| [ADR-006](adr/ADR-006-ai-on-azure-foundry.md)               | AI on Azure AI Foundry: structured output, citations, human decides, eval set                                                    |
| [ADR-007](adr/ADR-007-lint-format-and-hooks.md)             | oxlint, Prettier, lefthook and ticket keys in commits                                                                            |
| [ADR-008](adr/ADR-008-dev-environment-shares-medvya-dev.md) | Dev environment shares Medvya dev in Central India, synthetic data only                                                          |
| [ADR-009](adr/ADR-009-identity-and-account-model.md)        | One External ID tenant for everyone, solo recruiters, agency clients with job-scoped access, one login kept apart, pricing later |
| [ADR-011](adr/ADR-011-dev-ai-in-uae-north-global.md)        | Dev AI in UAE North; `gpt-main` on Global Standard as a dev-only exception to in-region inference                                |
| [ADR-012](adr/ADR-012-operator-console.md)                  | The operator console: operators from configuration, fails closed, never bypasses RLS, platform audit log                         |

A new decision gets the next number, `Status: Proposed`, and is accepted in the PR that implements it.
