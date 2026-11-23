"""Scenario: The service is not public. Internal ingress is reach; this is the policy (ADR-015 point 2)."""

import time
from collections.abc import Callable
from typing import Any

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from ai_service.app import PUBLIC_PATHS
from ai_service.auth import require_caller

from .conftest import OTHER, FakeModel, token

TASK = "/tasks/assistant.answer"


# SAFETY: mutation check: removed the require_caller dependency from run_task -> this test and the 401 tests failed
def test_every_route_but_the_probes_declares_the_caller_check(client: TestClient) -> None:
    routes = [route for route in client.app.routes if isinstance(route, APIRoute)]  # type: ignore[attr-defined]
    assert {route.path for route in routes} >= PUBLIC_PATHS
    for route in routes:
        if route.path not in PUBLIC_PATHS:
            assert require_caller in [d.call for d in route.dependant.dependencies], route.path


@pytest.mark.parametrize(
    "authorization",
    [
        None,
        "Basic abc",
        "Bearer not-a-jwt",
        f"Bearer {token(aud='api://another-service.credalent.example')}",
        f"Bearer {token(iss='https://sts.windows.net/00000000-0000-4000-8000-0000000000ff/')}",
        f"Bearer {token(exp=int(time.time()) - 60)}",
        f"Bearer {token(oid=None)}",
        f"Bearer {token(key=rsa.generate_private_key(public_exponent=65537, key_size=2048))}",
    ],
    ids=["none", "basic", "garbage", "audience", "issuer", "expired", "no-oid", "foreign-key"],
)
def test_a_call_without_a_valid_token_is_refused_before_the_model(
    client: TestClient, model: FakeModel, example: Callable[[str], dict[str, Any]], authorization: str | None
) -> None:
    headers = {"authorization": authorization} if authorization else {}
    response = client.post(TASK, json=example("request.json"), headers=headers)
    assert response.status_code == 401
    assert model.calls == []


def test_a_valid_token_for_an_identity_not_allowed_is_forbidden(
    client: TestClient, model: FakeModel, example: Callable[[str], dict[str, Any]]
) -> None:
    response = client.post(TASK, json=example("request.json"), headers={"authorization": f"Bearer {token(oid=OTHER)}"})
    assert response.status_code == 403
    assert model.calls == []


def test_the_token_is_checked_before_the_body(client: TestClient) -> None:
    assert client.post(TASK, json={"prompt": 1}).status_code == 401


def test_the_allowed_caller_is_served(client: TestClient, example: Callable[[str], dict[str, Any]]) -> None:
    response = client.post(TASK, json=example("request.json"), headers={"authorization": f"Bearer {token()}"})
    assert response.status_code == 200


def test_a_v2_token_is_accepted_too(client: TestClient, example: Callable[[str], dict[str, Any]]) -> None:
    v2 = token(iss="https://login.microsoftonline.com/00000000-0000-4000-8000-0000000000aa/v2.0")
    assert client.post(TASK, json=example("request.json"), headers={"authorization": f"Bearer {v2}"}).status_code == 200
