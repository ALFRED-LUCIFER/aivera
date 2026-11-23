"""The model call: Azure OpenAI on AI Foundry with the service's managed identity, never a key (ADR-015 point 2)."""

from typing import Any, Protocol

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from openai import AzureOpenAI

from .contract import TaskRequest, Usage

# GA, with structured outputs and max_completion_tokens.
API_VERSION = "2024-10-21"


class Model(Protocol):
    name: str

    def complete(self, task: str, request: TaskRequest, schema: dict[str, Any]) -> tuple[str, Usage]:
        """One structured completion: the raw output text and the tokens it spent."""
        ...

    def ping(self) -> None:
        """Raises when the model resource cannot be reached with this identity."""
        ...


class AzureModel:
    def __init__(self, resource_name: str, deployment: str) -> None:
        # In Azure, DefaultAzureCredential picks the user-assigned identity named by AZURE_CLIENT_ID.
        token = get_bearer_token_provider(DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default")
        # Retries are the caller's (@credalent/ai counts attempts and breaks the circuit), so none here.
        self._client = AzureOpenAI(
            azure_endpoint=f"https://{resource_name}.openai.azure.com",
            api_version=API_VERSION,
            azure_ad_token_provider=token,
            max_retries=0,
            # Under the caller's 60 s, with room for a cold start: a call it gave up on is never spent unseen.
            timeout=45,
        )
        self.name = deployment

    def complete(self, task: str, request: TaskRequest, schema: dict[str, Any]) -> tuple[str, Usage]:
        response = self._client.chat.completions.create(
            model=self.name,
            messages=[{"role": "system", "content": request.system}, {"role": "user", "content": request.prompt}],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": task.replace(".", "_"), "strict": True, "schema": schema},
            },
            # shortcut: bounds the output only, so input plus output can pass the cap; @credalent/ai then charges the
            # call and fails it. Count the prompt's tokens here (a tokenizer dependency) if pages grow near the cap.
            max_completion_tokens=min(request.maxOutputTokens, request.tokenCap),
            temperature=request.temperature,
        )
        usage = response.usage
        if usage is None:  # the budget must never rest on a count the model left out
            raise ValueError("no usage reported")
        return response.choices[0].message.content or "", Usage(
            inputTokens=usage.prompt_tokens, outputTokens=usage.completion_tokens
        )

    def ping(self) -> None:
        # shortcut: proves the resource answers this identity, not that the deployment exists; probe the deployment
        # itself if a missing deployment ever passes readiness.
        self._client.with_options(timeout=3).models.list()
