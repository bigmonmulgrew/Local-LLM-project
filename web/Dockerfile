FROM ghcr.io/astral-sh/uv:0.11.33 AS uv

FROM python:3.14-slim AS builder
COPY --from=uv /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY src ./src
RUN uv sync --frozen --no-dev

FROM builder AS test
RUN uv sync --frozen
COPY tests ./tests
RUN pytest

FROM python:3.14-slim AS runtime
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN groupadd --system app && useradd --system --gid app --home-dir /app app


USER root
RUN mkdir -p /app/data/uploads \
    && chown -R app:app /app/data

WORKDIR /app
COPY --from=builder --chown=app:app /app /app
USER app
EXPOSE 8000
CMD ["uvicorn", "L3M_Web.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
