"""Scenario: Health endpoints."""

from fastapi.testclient import TestClient

from .conftest import FakeModel


def test_healthz_answers_without_a_token(client: TestClient) -> None:
    assert client.get("/healthz").status_code == 200


def test_readyz_answers_when_the_model_is_reachable(client: TestClient) -> None:
    assert client.get("/readyz").status_code == 200


def test_readyz_fails_when_the_model_is_unreachable(client: TestClient, model: FakeModel) -> None:
    model.reachable = False
    response = client.get("/readyz")
    assert response.status_code == 503
    assert "unreachable" in response.text
