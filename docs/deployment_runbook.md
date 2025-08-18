# Olexi Extension Host — Deployment & Operations Runbook

This document is the single source of truth for the Extension Host service running on Google Cloud Run.

Service summary
- Project: olexi-extension (ID)
- Region: australia-southeast1
- Service name: olexi-extension-host
- Service URL: https://olexi-extension-host-655512577217.australia-southeast1.run.app
- Container image: australia-southeast1-docker.pkg.dev/olexi-extension/olexi-ext/olexi-extension-host:latest
- Runtime SA: olexi-extension-host-runner@olexi-extension.iam.gserviceaccount.com
- Secrets: Secret Manager
  - olexi-host-google-api-key (HOST_GOOGLE_API_KEY)

## Source layout
- Extension & Host root: `olexi-extension/` (project root directory)
- Server code: `olexi-extension/server/`
  - `main.py` — FastAPI app (ASGI)
  - `host_agent.py` — GenAI planner/summarizer (uses HOST_GOOGLE_API_KEY)
  - `database_map.py` — Local database list
  - `Dockerfile` — Runtime image for server (updated for current project structure)
- Extension (Chrome) code: `olexi-extension/webext/`
  - `manifest.json`, `content.js`, `style.css`, icons, popup
- Build config: `olexi-extension/cloudbuild.yaml`
- Upload control: `olexi-extension/.gcloudignore`

**Note**: Project structure was updated where `olexi-extension` is now the root directory (previously was under `austlii-mcp-server/olexi-extension`). Dockerfile has been updated accordingly to use `COPY . /app/olexi-extension` for the new structure.

## Environment configuration
- Env vars
  - MCP_URL: MCP service URL (string)
  - HOST_GOOGLE_API_KEY: injected from Secret Manager
  - HOST_MODEL: optional override (default: gemini-2.5-flash)
  - ALLOWED_ORIGINS: optional, comma-separated CORS allowlist
  - ALLOWED_ORIGIN_REGEX: optional regex allowlist
- Secret Manager
  - Name: `olexi-host-google-api-key`
  - Rotation: add a new version; service uses `latest` when set in deploy flags

## Build and publish
- Required APIs: artifactregistry, run, cloudbuild, secretmanager
- Artifact Registry repo: `olexi-ext` (australia-southeast1)
- Build with Cloud Build from `olexi-extension/` root:
  - Uses `cloudbuild.yaml`
  - Tags: `:latest` and `:$BUILD_ID`

## Deploy to Cloud Run
- Default settings (current):
  - Region: australia-southeast1
  - Min instances: 0 (scale to zero)
  - Max instances: 3
  - CPU: 1 vCPU, Memory: 512Mi, Port: 8080
  - Ingress: public (unauthenticated allowed)
  - Env vars: MCP_URL
  - Secret: HOST_GOOGLE_API_KEY from `olexi-host-google-api-key:latest`

## Operations
- Logs: Cloud Run logs in Cloud Logging (service: olexi-extension-host)
- Metrics: Cloud Monitoring (Requests, Latency, Errors)
- Current revision: `olexi-extension-host-00003-g6d` (deployed 2025-08-18)
- Common updates:
  - Rebuild image via Cloud Build
  - Deploy new revision via `gcloud run deploy`
  - Update env/secrets via deploy flags

## Security
- Public service; lock down CORS with ALLOWED_ORIGINS post-store launch.
- Service Account has only `secretmanager.secretAccessor`.
- Secrets are not baked into images.

## Disaster Recovery
- Rebuild from repo and redeploy following steps below.
- Recreate secrets from key vault/backups.

## Step-by-step: Fresh setup
1) Enable APIs:
- artifactregistry.googleapis.com
- run.googleapis.com
- cloudbuild.googleapis.com
- secretmanager.googleapis.com

2) Create Artifact Registry repo (once):
- Name: olexi-ext, Format: DOCKER, Region: australia-southeast1

3) Secrets:
- Create Secret `olexi-host-google-api-key`
- Add version with your Google API key

4) Service Account:
- Create `olexi-extension-host-runner` and grant `roles/secretmanager.secretAccessor`

5) Build (from `olexi-extension/`):
- gcloud builds submit --config cloudbuild.yaml

6) Deploy:
- Deploy Cloud Run service `olexi-extension-host` with:
  - `--image` of pushed artifact
  - `--allow-unauthenticated`
  - `--service-account olexi-extension-host-runner@...`
  - `--set-env-vars MCP_URL=...`
  - `--set-secrets HOST_GOOGLE_API_KEY=olexi-host-google-api-key:latest`

7) Verify:
- Hit the Service URL `/` and confirm JSON status

## Post-launch hardening (see production_hardening_plan.md)
- Set ALLOWED_ORIGINS with Chrome Web Store extension ID(s)
- Increase min instances to 1
- Configure monitoring dashboards and alerting

## Appendix: Useful commands (reference)
- Rebuild & push via Cloud Build (uses cloudbuild file): `gcloud builds submit --config cloudbuild.yaml`
- Update env vars: redeploy with `--set-env-vars`
- Update secret version: add version; service will use `latest` if configured
- Quick deployment check: `curl -s https://olexi-extension-host-655512577217.australia-southeast1.run.app/`

## Recent Changes
- **2025-08-18**: Fixed Dockerfile for new project structure where `olexi-extension` is root directory
- **2025-08-18**: Deployed revision `olexi-extension-host-00003-g6d` with corrected build context

Last updated: 2025-08-18
