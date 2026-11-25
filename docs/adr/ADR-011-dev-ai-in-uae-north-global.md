# ADR-011: Dev AI runs in UAE North, with gpt-main on Global Standard

- **Status:** Accepted, 19 Nov 2026
- **Ticket:** AIV-P0-034

## Context

`@credalent/ai` (AIV-P0-027) calls two deployments, `gpt-main` (gpt-4.1-mini) and `embedding-main` (text-embedding-3-large), on an Azure AI resource. Dev lives in Medvya's resource group in Central India ([ADR-008](ADR-008-dev-environment-shares-medvya-dev.md)), and the dev cost rule is pay-as-you-go, cheapest tier.

On 19 Nov 2026 (`az cognitiveservices model list`), Central India offered gpt-4.1-mini only as Global Provisioned (reserved throughput, billed per hour) and no embedding model at all. UAE North offered gpt-4.1-mini only as Global Standard, which is pay per token but may run inference in any Azure region. It offered text-embedding-3-large as regional Standard.

AGENTS.md 1.10 forbids inference outside the region without an ADR.

## Decision

1. The dev AI resource `ai-aivera-dev-<6 chars>` (kind AIServices, S0) is in UAE North, in Credalent's own resource group `rg-aivera-ai-dev`, declared in `infra/modules/ai.bicep`. It is not in Medvya's group: that group's policy `allowed-locations-in` allows Central India and South India only, and the policy stays as it is.
2. `gpt-main` is gpt-4.1-mini on **Global Standard**. This is an exception to AGENTS.md 1.10 for **dev only**. It is acceptable there because dev holds synthetic data only (AGENTS.md 1.1). `embedding-main` is text-embedding-3-large on regional Standard.
3. There are no keys (`disableLocalAuth`). The web app's identity `id-aivera-dev` has Cognitive Services OpenAI User on this account only, and since AIV-P1-135 Cognitive Services User on it too, for Document Intelligence (shared with the worker).

## Consequences

- Dev AI costs cents a month at dev volume, with no reserved capacity.
- **The pilot cannot copy this.** It needs an in-region chat deployment: regional Standard if UAE North adds it for the chosen model, Provisioned if not, or a new ADR. That decision belongs to the launch epic AIV-P5-E03 (#34).
- Prompts sent to Azure OpenAI may be kept for abuse monitoring under Microsoft's terms. That is harmless with synthetic data; the pilot must review it.
