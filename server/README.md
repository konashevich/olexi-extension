# Olexi Extension Host (Server)

A FastAPI server that orchestrates research sessions for the Olexi Chrome extension.

- Entry point: `main.py` (ASGI app: `server.main:app`)
- Start locally with uvicorn on port 3000.
- Connects to remote MCP (set `MCP_URL` in `.env`).
- Requires a Google AI key for host-side planning/summarization (`HOST_GOOGLE_API_KEY`).

Run locally
- Create and configure `.env` from the template provided.
- Install dependencies from the project root `requirements.txt`.
- Start: `python -m uvicorn server.main:app --reload --port 3000`

Deployment
- Prepare a container/Dockerfile or serverless target. Ensure `.env` values are provided via secrets/vars.
