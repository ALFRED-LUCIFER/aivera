"""The AI service (AIV-P2-068, ADR-015): one model call per task call, for @credalent/ai only.

It never sees a database or unredacted text, and never checks citations or budgets in place of @credalent/ai: it
calls the model with the request's prompt, caps and the task's output schema, and returns the raw output and the
tokens spent. Logs carry the task, prompt version, model, token counts, latency and outcome only (AGENTS.md 3.17).
"""

import json
import logging
import os
import time
from pathlib import Path
from typing import Annotated, Any

import openai
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .auth import Verifier, entra_verifier, require_caller
from .contract import TaskRequest, TaskResponse
from .model import AzureModel, Model

log = logging.getLogger("ai_service")

CONTRACT = Path(__file__).resolve().parents[2] / "contract"
# Public: the platform's probes carry no token, and the answers say nothing but up or down.
PUBLIC_PATHS = frozenset({"/healthz", "/readyz"})
LOG_FIELDS = ("task", "promptVersion", "model", "inputTokens", "outputTokens", "latencyMs", "outcome", "caller")


def task_schemas() -> dict[str, dict[str, Any]]:
    """Each task's output schema, generated from its zod schema; `$schema` is left out for Azure strict mode."""
    schemas = {}
    for file in sorted((CONTRACT / "tasks").glob("*.schema.json")):
        schema = json.loads(file.read_text())
        schema.pop("$schema", None)
        schemas[file.name.removesuffix(".schema.json")] = schema
    return schemas


class AllowlistFormatter(logging.Formatter):
    """One JSON line per record: the message template and the allowlisted fields, never arguments or exception text."""

    def format(self, record: logging.LogRecord) -> str:
        fields = {key: getattr(record, key) for key in LOG_FIELDS if hasattr(record, key)}
        # A non-string message (log.error(exc)) is named by its type: json.dumps failing would print it to stderr.
        message = record.msg if isinstance(record.msg, str) else type(record.msg).__name__
        return json.dumps(
            {"level": record.levelname, "message": message, **fields}, default=lambda value: type(value).__name__
        )


def _failure(error: Exception) -> tuple[int, str, dict[str, str]]:
    """The status @credalent/ai retries on (429, 503) or not (502), and the model's retry hints. Never its message."""
    if isinstance(error, openai.APIStatusError):
        if error.status_code == 429:
            hints = {k: v for k in ("retry-after-ms", "retry-after") if (v := error.response.headers.get(k))}
            return 429, "rate_limited", hints
        return (503, "model_unavailable", {}) if error.status_code >= 500 else (502, "model_refused", {})
    if isinstance(error, openai.APIConnectionError):  # includes timeouts
        return 503, "model_unreachable", {}
    # Not 500: the caller retries 5xx, and a bug does not go away on a retry.
    return 502, "error", {}


def create_app(model: Model, verify: Verifier) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.verify = verify
    schemas = task_schemas()

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _error: RequestValidationError) -> JSONResponse:
        # FastAPI's default answer repeats the input; a prompt must never travel back or into a log.
        return JSONResponse({"error": "invalid_request"}, status_code=422)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz() -> JSONResponse:
        try:
            model.ping()
        # Any failure means not ready; its text may quote the provider, so it is not logged.
        except Exception:  # noqa: BLE001
            log.warning("model unreachable", extra={"model": model.name, "outcome": "not_ready"})
            return JSONResponse({"status": "model unreachable"}, status_code=503)
        return JSONResponse({"status": "ready"})

    @app.post("/tasks/{task}")
    def run_task(task: str, body: TaskRequest, caller: Annotated[str, Depends(require_caller)]) -> TaskResponse:
        schema = schemas.get(task)
        if schema is None:
            raise HTTPException(404)
        start = time.perf_counter()
        fields: dict[str, Any] = {
            "task": task,
            "promptVersion": body.promptVersion,
            "model": model.name,
            "caller": caller,
        }
        try:
            output, usage = model.complete(task, body, schema)
        # Every failure maps to a status; the error's text may quote the prompt, so it is never logged or returned.
        except Exception as error:  # noqa: BLE001
            status, outcome, headers = _failure(error)
            latency = round((time.perf_counter() - start) * 1000)
            log.warning("task failed", extra={**fields, "outcome": outcome, "latencyMs": latency})
            raise HTTPException(status, headers=headers or None) from None
        latency = round((time.perf_counter() - start) * 1000)
        log.info(
            "task done",
            extra={
                **fields,
                "outcome": "ok",
                "latencyMs": latency,
                "inputTokens": usage.inputTokens,
                "outputTokens": usage.outputTokens,
            },
        )
        return TaskResponse(output=output, usage=usage)

    return app


def _env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Invalid configuration, missing: {name}")
    return value


def app_from_env() -> FastAPI:
    """The deployed app (`uvicorn --factory ai_service.app:app_from_env`): configuration from the environment only."""
    # Every logger, not only ours: uvicorn's tracebacks and the SDKs' messages go through the allowlist too. uvicorn
    # sets its own handlers before it calls this factory, so they are replaced here.
    handler = logging.StreamHandler()
    handler.setFormatter(AllowlistFormatter())
    logging.basicConfig(handlers=[handler], level=logging.INFO, force=True)
    # uvicorn.error has no handler of its own: it reaches this one once, through uvicorn.
    for name in ("uvicorn", "uvicorn.access"):
        logging.getLogger(name).handlers = [handler]
    allowed = frozenset(c.strip() for c in _env("AI_SERVICE_ALLOWED_CALLERS").split(",") if c.strip())
    return create_app(
        AzureModel(_env("AZURE_OPENAI_RESOURCE_NAME"), os.environ.get("AI_DEPLOYMENT", "gpt-main")),
        entra_verifier(_env("AZURE_TENANT_ID"), _env("AI_SERVICE_AUDIENCE"), allowed),
    )
