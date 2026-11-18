# ADR-001: Technology stack

- **Status:** Accepted, 18 Nov 2026
- **Ticket:** AIV-P0-001

## Context

Aivera needs a recruiter web app, public pages, a candidate site, background work (evidence ingestion, scoring, scheduled follow-ups) and AI that is explainable. Customers are in the UAE and KSA, so data residency matters. The owner's earlier product (Medvya) used .NET 10 + React; its architecture patterns are reused here (ADR-002), but a single language removes a whole class of contract drift for a small team.

## Decision

TypeScript end to end, on Azure.

| Layer          | Choice                                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web            | Next.js 16 App Router, React 19, TypeScript 6 (strict)                                                                                                                                                   |
| UI             | Tailwind CSS 4, shadcn/ui on Radix, `next/font` (Bricolage Grotesque, Hanken Grotesk, JetBrains Mono), TanStack Query and Table, React Hook Form + Zod, hand-drawn SVG for score charts                  |
| Back end       | Modules as packages (ADR-002), called from Next.js server actions and route handlers; a Node worker (`apps/worker`) for queued and scheduled jobs. No separate REST API until a second client needs one. |
| Database       | Azure Database for PostgreSQL Flexible Server 17, Drizzle ORM, Drizzle Kit migrations (ADR-004), pgvector for embeddings                                                                                 |
| AI             | Azure AI Foundry (Azure OpenAI models) through the AI SDK `@ai-sdk/azure` (ADR-006); Azure AI Document Intelligence for CVs and PDFs; GitHub API (Octokit) for commit authorship                         |
| Messaging      | Azure Service Bus (scheduled messages for follow-ups), transactional outbox in PostgreSQL                                                                                                                |
| Files          | Azure Blob Storage, direct browser upload with SAS, Defender for Storage malware scanning                                                                                                                |
| Identity       | Entra External ID (one tenant, all users; company SSO by federation later) ([ADR-009](ADR-009-identity-and-account-model.md))                                                                            |
| Email          | Azure Communication Services Email; Microsoft Graph for messages sent from the recruiter's own mailbox                                                                                                   |
| Payments       | Stripe (candidate Plus, AED)                                                                                                                                                                             |
| Hosting        | Azure Container Apps (web, worker), Azure Front Door (custom domains, portfolio subdomains), Key Vault with managed identity, Application Insights via OpenTelemetry                                     |
| Infrastructure | Bicep, GitHub Actions                                                                                                                                                                                    |
| Region         | UAE North (dev shares Medvya dev in Central India with synthetic data only: [ADR-008](ADR-008-dev-environment-shares-medvya-dev.md))                                                                     |
| Tooling        | pnpm 11 workspaces, Turborepo, Node 24 LTS, Vitest, Playwright, Testcontainers, oxlint, Prettier, lefthook (ADR-007)                                                                                     |

## Consequences

- One language and shared zod schemas across UI, server, worker and AI output: no generated API client is needed while the only client is our own app.
- Azure AI Search, microservices and GraphQL are not used; revisit search if pgvector stops meeting latency at real evidence volumes.
- Model availability in UAE North must be confirmed before each model is adopted (ADR-006).
- C# remains an option for a future service only through a new ADR.
