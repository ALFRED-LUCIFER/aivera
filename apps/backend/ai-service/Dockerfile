# The AI service image (AIV-P2-068, ADR-015). Its own build context: docker build apps/backend/ai-service
# Dependencies come from uv.lock only (--locked); no dev tools in the image; runs as a non-root user.
FROM ghcr.io/astral-sh/uv:0.11.8@sha256:3b7b60a81d3c57ef471703e5c83fd4aaa33abcd403596fb22ab07db85ae91347 AS uv

FROM python:3.13-slim@sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_CACHE=1 PATH="/app/.venv/bin:$PATH"
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY contract ./contract
COPY src ./src
RUN uv sync --locked --no-dev && useradd --system --uid 10001 service
USER service
EXPOSE 8080
# No access log: the task log is the record, and an access line adds nothing it lacks.
CMD ["uvicorn", "--factory", "ai_service.app:app_from_env", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
