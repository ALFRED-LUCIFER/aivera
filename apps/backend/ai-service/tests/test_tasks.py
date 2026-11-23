"""Scenarios: One task end to end, and No text in logs (AIV-P2-068)."""

import json
import logging
import sys
from collections.abc import Callable
from typing import Any

import httpx2 as httpx  # openai's own HTTP client (a declared dev dependency)
import openai
import pytest
from fastapi.testclient import TestClient

from ai_service.app import AllowlistFormatter

from .conftest import WEB, FakeModel, token

TASK = "/tasks/assistant.answer"
AUTH = {"authorization": f"Bearer {token()}"}
PROMPT_TEXT = "Built a merchant assistant used by about 9,000 merchants"


def test_the_task_calls_the_model_with_the_request_and_its_output_schema(
    client: TestClient, model: FakeModel, example: Callable[[str], dict[str, Any]]
) -> None:
    model.output = '{"statements":[{"text":"x","citations":[{"sourceId":"S1","quote":"wrote 412"}]}]}'
    response = client.post(TASK, json=example("request.json"), headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {"output": model.output, "usage": {"inputTokens": 900, "outputTokens": 100}}
    task, request, schema = model.calls[0]
    assert (task, request.promptVersion, request.tokenCap) == ("assistant.answer", "assistant.answer@1", 30000)
    assert "$schema" not in schema
    assert schema["required"] == ["statements"]
    assert schema["additionalProperties"] is False


def test_an_unknown_task_is_not_found(client: TestClient, example: Callable[[str], dict[str, Any]]) -> None:
    assert client.post("/tasks/jobs.draftCompetencies", json=example("request.json"), headers=AUTH).status_code == 404


def test_an_invalid_request_is_refused_without_repeating_it(
    client: TestClient, model: FakeModel, example: Callable[[str], dict[str, Any]]
) -> None:
    body = {**example("request.json"), "prompt": PROMPT_TEXT, "tokenCap": 0}
    response = client.post(TASK, json=body, headers=AUTH)
    assert response.status_code == 422
    assert PROMPT_TEXT not in response.text
    assert model.calls == []


def _status_error(status: int, headers: dict[str, str] | None = None) -> openai.APIStatusError:
    request = httpx.Request("POST", "https://model.credalent.example")
    response = httpx.Response(status, headers=headers, request=request)
    return openai.APIStatusError(f"the model echoed: {PROMPT_TEXT}", response=response, body=None)


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (_status_error(429, {"retry-after-ms": "1200"}), 429),
        (_status_error(500), 503),
        (_status_error(400), 502),
        (openai.APITimeoutError(httpx.Request("POST", "https://model.credalent.example")), 503),
        (ValueError(PROMPT_TEXT), 502),
    ],
    ids=["rate-limited", "model-5xx", "model-4xx", "timeout", "bug"],
)
def test_a_model_failure_maps_to_a_status_the_caller_retries_or_not(
    client: TestClient,
    model: FakeModel,
    example: Callable[[str], dict[str, Any]],
    error: Exception,
    status: int,
) -> None:
    model.error = error
    response = client.post(TASK, json=example("request.json"), headers=AUTH)
    assert response.status_code == status
    assert PROMPT_TEXT not in response.text
    if status == 429:
        assert response.headers["retry-after-ms"] == "1200"


# SAFETY: mutation check: AllowlistFormatter emitted record.getMessage() and every record attribute -> this test failed
def test_logs_carry_task_ids_tokens_and_durations_only(
    client: TestClient,
    model: FakeModel,
    example: Callable[[str], dict[str, Any]],
    caplog: pytest.LogCaptureFixture,
) -> None:
    model.output = json.dumps(
        {"statements": [{"text": PROMPT_TEXT, "citations": [{"sourceId": "S1", "quote": PROMPT_TEXT}]}]}
    )
    body = {**example("request.json"), "prompt": f"Question: what? Sources: {PROMPT_TEXT}", "system": PROMPT_TEXT}
    with caplog.at_level(logging.INFO, logger="ai_service"):
        assert client.post(TASK, json=body, headers=AUTH).status_code == 200
        model.error = _status_error(500)
        assert client.post(TASK, json=body, headers=AUTH).status_code == 503
    lines = [json.loads(AllowlistFormatter().format(record)) for record in caplog.records]
    assert PROMPT_TEXT not in json.dumps(lines)
    assert lines[0] == {
        "level": "INFO",
        "message": "task done",
        "task": "assistant.answer",
        "promptVersion": "assistant.answer@1",
        "model": "gpt-main",
        "inputTokens": 900,
        "outputTokens": 100,
        "latencyMs": lines[0]["latencyMs"],
        "outcome": "ok",
        "caller": WEB,
    }
    assert lines[1]["outcome"] == "model_unavailable"


def test_the_formatter_drops_arguments_and_tracebacks() -> None:
    try:
        raise ValueError(PROMPT_TEXT)
    except ValueError:
        record = logging.LogRecord("uvicorn.error", logging.ERROR, __file__, 1, "Exception: %s", (PROMPT_TEXT,), None)
        record.exc_info = sys.exc_info()
    line = AllowlistFormatter().format(record)
    assert PROMPT_TEXT not in line
    assert json.loads(line) == {"level": "ERROR", "message": "Exception: %s"}


def test_the_formatter_names_a_non_string_message_by_its_type() -> None:
    record = logging.LogRecord("openai", logging.ERROR, __file__, 1, ValueError(PROMPT_TEXT), None, None)
    line = AllowlistFormatter().format(record)
    assert PROMPT_TEXT not in line
    assert json.loads(line) == {"level": "ERROR", "message": "ValueError"}
