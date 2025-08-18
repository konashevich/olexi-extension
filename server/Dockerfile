# Dockerfile for Olexi Extension Host (FastAPI + Uvicorn)
# Builds a slim Python image that runs `server.main:app`

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080 \
    PYTHONPATH=/app

# System deps
RUN apt-get update -y && apt-get install -y --no-install-recommends \
    ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements from repo root for layer caching
COPY requirements.txt ./
RUN python -m venv .venv && . .venv/bin/activate && \
    pip install --upgrade pip && \
    pip install -r requirements.txt

# Copy only the extension package
COPY olexi-extension /app/olexi-extension

# Ensure no local .env is baked into the image
RUN rm -f /app/olexi-extension/server/.env || true

# Non-root user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

# Work from extension package root so `server.main` is importable
WORKDIR /app/olexi-extension

# Cloud Run listens on $PORT (default 8080)
EXPOSE 8080

# Start the ASGI app; host 0.0.0.0, port $PORT per Cloud Run contract
CMD ["/app/.venv/bin/python", "-m", "uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8080"]
