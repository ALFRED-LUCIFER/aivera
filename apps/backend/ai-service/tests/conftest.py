"""Test doubles: a signing key standing in for the tenant's, and a model that records its calls. Synthetic data only."""

import json
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from ai_service.app import create_app
from ai_service.auth import entra_verifier
from ai_service.contract import TaskRequest, Usage

TENANT = "00000000-0000-4000-8000-0000000000aa"
AUDIENCE = "api://ai-service.credalent.example"
WEB = "00000000-0000-4000-8000-00000000000b"  # the web app's identity, the one allowed caller
OTHER = "00000000-0000-4000-8000-00000000000c"
EXAMPLES = Path(__file__).resolve().parents[1] / "contract" / "examples"

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeKeys(jwt.PyJWKClient):
    """The tenant's key set, without the network: every token is checked against KEY's public half."""

    def __init__(self) -> None:
        super().__init__("https://login.microsoftonline.com.invalid/keys")

    def get_signing_key_from_jwt(self, token: str | bytes) -> jwt.PyJWK:
        return jwt.PyJWK.from_dict(json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(KEY.public_key())))


def token(key: rsa.RSAPrivateKey = KEY, **overrides: Any) -> str:
    now = int(time.time())
    claims = {
        "iss": f"https://sts.windows.net/{TENANT}/",
        "aud": AUDIENCE,
        "oid": WEB,
        "iat": now,
        "exp": now + 600,
        **overrides,
    }
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, key, algorithm="RS256")


class FakeModel:
    name = "gpt-main"

    def __init__(self) -> None:
        self.calls: list[tuple[str, TaskRequest, dict[str, Any]]] = []
        self.output = '{"statements":[]}'
        self.usage = Usage(inputTokens=900, outputTokens=100)
        self.error: Exception | None = None
        self.reachable = True

    def complete(self, task: str, request: TaskRequest, schema: dict[str, Any]) -> tuple[str, Usage]:
        self.calls.append((task, request, schema))
        if self.error:
            raise self.error
        return self.output, self.usage

    def ping(self) -> None:
        if not self.reachable:
            raise ConnectionError("model resource unreachable")


@pytest.fixture
def model() -> FakeModel:
    return FakeModel()


@pytest.fixture
def client(model: FakeModel) -> TestClient:
    verify = entra_verifier(TENANT, AUDIENCE, frozenset({WEB}), FakeKeys())
    return TestClient(create_app(model, verify), raise_server_exceptions=False)


@pytest.fixture
def example() -> Callable[[str], dict[str, Any]]:
    def load(name: str) -> dict[str, Any]:
        value: dict[str, Any] = json.loads((EXAMPLES / name).read_text())
        return value

    return load
