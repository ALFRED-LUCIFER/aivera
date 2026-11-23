"""Generates the pydantic models from contract/*.schema.json (ADR-015 point 4, AGENTS.md 3.16).

Run `uv run python scripts/generate_contract.py` after `pnpm --filter @credalent/ai contract`. tests/test_contract.py
runs the same generation into a temporary folder and fails on any difference.
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = {"request": "TaskRequest", "response": "TaskResponse"}


def generate(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name, class_name in MODELS.items():
        # Fixed arguments and no shell: nothing untrusted reaches the command.
        subprocess.run(  # noqa: S603
            [
                sys.executable,
                "-m",
                "datamodel_code_generator",
                "--input",
                str(ROOT / "contract" / f"{name}.schema.json"),
                "--input-file-type",
                "jsonschema",
                "--output-model-type",
                "pydantic_v2.BaseModel",
                "--class-name",
                class_name,
                "--output",
                str(out / f"{name}.py"),
                "--disable-timestamp",
                "--use-annotated",
                "--field-constraints",
                "--target-python-version",
                "3.13",
                "--formatters",
                "black",
                "isort",
            ],
            check=True,
            capture_output=True,
        )


if __name__ == "__main__":
    generate(ROOT / "src" / "ai_service" / "contract")
