# AI service (`apps/backend/ai-service`)

Python and FastAPI. It makes the model call for the tasks `@credalent/ai` sends it, and nothing else ([ADR-015](../../../docs/adr/ADR-015-python-ai-service.md), AGENTS.md 3.14 to 3.18). The first task is `assistant.answer` (AIV-P2-068).

- **What stays in TypeScript:** redaction, the token budget, the prompt text and the citation check, in `@credalent/ai` (`packages/ai/src/client.ts`). The service gets redacted, formatted text and a token cap, and returns the raw output and the tokens it spent.
- **Who may call:** every `/tasks/<task>` call needs an Entra token for `AI_SERVICE_AUDIENCE` from an object id in `AI_SERVICE_ALLOWED_CALLERS` (`src/ai_service/auth.py`). `/healthz` and `/readyz` are open for the platform's probes. `/readyz` fails when the model resource cannot be reached.
- **Logs:** JSON lines with the task, prompt version, model, token counts, latency, outcome and caller id only (`AllowlistFormatter`). Never prompt or answer text.
- **No database:** no connection string, role or credential.

## Develop

```sh
uv sync --locked
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
```

## Change the contract

The JSON Schema in `contract/` is generated from the zod schemas in `packages/ai/src/service.ts`, and the pydantic models in `src/ai_service/contract/` are generated from it. Never edit either by hand:

```sh
pnpm --filter @credalent/ai contract           # zod -> contract/*.schema.json
uv run python scripts/generate_contract.py     # JSON Schema -> pydantic
```

`packages/ai/src/service.test.ts` and `tests/test_contract.py` fail when either side drifts. `contract/examples/` holds one request and one response that both sides validate.

## Configuration

| Variable                     | What                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| `AZURE_TENANT_ID`            | The workforce tenant that issues the callers' tokens                |
| `AI_SERVICE_AUDIENCE`        | The service's app registration, `api://<appId>`                     |
| `AI_SERVICE_ALLOWED_CALLERS` | Comma-separated object ids allowed to call (the web app's identity) |
| `AZURE_OPENAI_RESOURCE_NAME` | The AI Foundry resource                                             |
| `AI_DEPLOYMENT`              | The model deployment, `gpt-main` by default                         |
| `AZURE_CLIENT_ID`            | The service's own managed identity                                  |

Deployed by `infra/modules/ai-service.bicep` once the owner sets `aiServiceAudience` ([infra/README.md](../../../infra/README.md#ai-service-aiv-p2-068-once)).
