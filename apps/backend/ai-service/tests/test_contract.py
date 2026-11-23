"""Scenario: Contract drift fails CI (ADR-015 point 4). packages/ai/src/service.test.ts checks the zod side."""

import importlib.util
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from ai_service.app import task_schemas
from ai_service.contract import TaskRequest, TaskResponse

ROOT = Path(__file__).resolve().parents[1]


def _generator() -> Callable[[Path], None]:
    spec = importlib.util.spec_from_file_location("generate_contract", ROOT / "scripts" / "generate_contract.py")
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    generate: Callable[[Path], None] = module.generate
    return generate


# SAFETY: mutation check: renamed tokenCap in contract/request.schema.json only -> this test failed
def test_the_committed_models_are_what_the_json_schema_generates(tmp_path: Path) -> None:
    _generator()(tmp_path)
    for name in ("request.py", "response.py"):
        committed = (ROOT / "src" / "ai_service" / "contract" / name).read_text()
        assert (tmp_path / name).read_text() == committed, f"{name}: run uv run python scripts/generate_contract.py"


def test_the_shared_examples_validate_here_as_they_do_in_typescript(example: Callable[[str], dict[str, Any]]) -> None:
    TaskRequest.model_validate(example("request.json"))
    TaskResponse.model_validate(example("response.json"))
    with pytest.raises(ValidationError):
        TaskRequest.model_validate({**example("request.json"), "extra": 1})


def test_every_task_has_an_output_schema() -> None:
    assert list(task_schemas()) == ["assistant.answer"]
