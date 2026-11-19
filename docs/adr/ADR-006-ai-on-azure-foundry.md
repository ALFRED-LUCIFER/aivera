# ADR-006: AI on Azure AI Foundry, with citations, structured output and a person deciding

- **Status:** Accepted, 18 Nov 2026
- **Ticket:** AIV-P0-001

## Context

Aivera uses language models to draft rubrics, read evidence, score competencies, write evidence requests, generate interview questions, tailor CVs and answer questions in the assistant. Hiring is a high-risk use of AI: a score must be explainable, a claim must never be passed off as evidence, and a model must never make the decision.

## Decision

1. **Provider.** Azure AI Foundry deployments (Azure OpenAI models) in UAE North, called through the AI SDK with `@ai-sdk/azure`, authenticated with managed identity. Embeddings: `text-embedding-3-large` into pgvector. CV and PDF text: Azure AI Document Intelligence. Before adopting a model, confirm it is deployable in UAE North; a model outside the region needs a new ADR. Dev's exception (Global Standard for `gpt-main`, synthetic data only) is [ADR-011](ADR-011-dev-ai-in-uae-north-global.md).
2. **One AI package** (`packages/ai`, `@aivera/ai`; a package rather than a module because it owns no tables, amended in AIV-P0-027) owns the client, prompt templates (versioned in code with an id like `assess-competency@3`), schemas and the eval harness. Other modules call its contracts; nothing else imports the AI SDK. **Amended in AIV-P0-033:** the per-workspace daily token budget is persisted, and the package still owns no tables. The client takes a narrow `TokenBudgetStore` port (`spentToday(workspaceId, day)`, `add(workspaceId, day, tokens)`), and the apps' composition root passes `createAiTokenBudget(db)` from `@aivera/workspaces/composition`. The `workspaces` module owns the table, `workspaces.ai_token_usage`: a workspace setting sits next to the workspace, and a new module would add a schema, contracts and composition for one table. The client fails closed (`AiUnavailable`, no model request) when the store cannot be read or written. `memoryTokenBudget()` is for unit tests only. No other module reads the table; the per-workspace budget override (AIV-P2-038) goes in the same module behind the same contract. **Amended in AIV-P2-038:** `spentToday` returns `{ spent, limit }` from one read, where `limit` is the operator's override (`workspaces.workspace.ai_daily_token_budget`, 100,000 to 10,000,000, a check constraint) or the platform default of 2,000,000 tokens per UTC day. The default and the bounds live in `workspaces` (`AI_DAILY_TOKEN_BUDGET`), so the client holds no budget figure of its own; `memoryTokenBudget(limit)` defaults to the same 2,000,000 for unit tests. A budget lowered below today's use stops the next call; calls in flight finish.
3. **Structured output only** for anything that feeds the product: a zod schema per task, validated; output that fails validation is rejected and retried once, then surfaced as "could not assess", never patched.
4. **Citations are mandatory.** Every competency judgement returns the evidence ids and exact quoted spans it rests on, plus its limit. The application checks each cited id exists and each quoted span occurs in that evidence; an uncited judgement counts as a claim (zero in the backed score).
5. **Evidence, not text, decides strength.** Provenance (corroborated, submitted, claim, contradictory, awaiting defence) comes from where the evidence came from and whether a second source confirms it, set by code, not by the model.
6. **A person decides.** Model output is a recommendation or a draft. Stage changes, messages, shares and decisions are previews that a person confirms (AGENTS.md 1.5). No model output ever rejects a candidate.
7. **Fairness inputs.** Prompts receive the evidence and the rubric, not the candidate's name, photo, age, nationality, gender or contact details. Those are stripped before the call.
8. **Eval set.** A golden set of synthetic candidates with expected scores and citations lives in `packages/ai/evals`. Every prompt or model change runs it in CI; a drop beyond the agreed tolerance fails the build.
9. **No candidate data in logs or telemetry**: log the prompt id, model, token counts, latency and outcome only.

## Consequences

- Scores are reproducible from stored evidence plus a prompt id and model version, which are saved with each assessment.
- Changing a model is a measured change, not a silent one.
- Some judgements will come back "could not assess"; the UI treats that as a gap, not a low score.
