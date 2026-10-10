FROM python:3.13-slim
WORKDIR /app
COPY backend/pyproject.toml ./
RUN pip install --no-cache-dir .
COPY backend/app ./app
COPY contracts /contracts
ENV CONTRACTS_DIR=/contracts
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
