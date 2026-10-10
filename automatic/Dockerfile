# Observation API + hazard worker image (optional automation profile). One process: the worker
# runs inside the service. Receives only AUTOMATION_DATABASE_URL, PRODUCT_API_URL and the
# publisher key; never the product database credential.
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never PATH=/opt/venv/bin:$PATH
# Same layout as the repository: the service locates the contracts relative to its own files.
WORKDIR /srv/automatic/service
COPY automatic/service/pyproject.toml automatic/service/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY automatic/service/app ./app
COPY contracts /srv/contracts
ENV CONTRACTS_DIR=/srv/contracts PYTHONUNBUFFERED=1
RUN useradd --system --uid 10001 --no-create-home app
USER app
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
