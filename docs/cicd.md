# CI/CD: Auto-deploy server on push to main

This repo includes a GitHub Actions workflow that builds and deploys the server to Google Cloud Run when you push changes to server-related files on the `main` branch.

Workflow file: `.github/workflows/deploy-server.yml`

Trigger paths:
- `server/**`
- `server/Dockerfile`
- `requirements.txt`
- `cloudbuild.olexi-extension-host.yaml`

## Configure secrets & variables (one-liner)
You can configure everything with the GitHub CLI using the helper script:

```bash
# export your values
export GCP_PROJECT_ID=olexi-extension
export GCP_REGION=australia-southeast1
export GAR_LOCATION=australia-southeast1
export GAR_REPOSITORY=olexi-ext
export CLOUD_RUN_SERVICE=olexi-extension-host
export CLOUD_RUN_SA=olexi-extension-host-runner@olexi-extension.iam.gserviceaccount.com

# provide the service account key (file or env)
export GCP_SA_KEY_FILE=~/sa-key.json
# or: export GCP_SA_KEY='{"type":"service_account",...}'

./tools/gha_setup.sh  # optionally: ./tools/gha_setup.sh --repo owner/repo
```

What it sets:
- Repository variables: `GCP_PROJECT_ID`, `GCP_REGION`, `GAR_LOCATION`, `GAR_REPOSITORY`, `CLOUD_RUN_SERVICE`, `CLOUD_RUN_SA`
- Repository secret: `GCP_SA_KEY` (JSON content)

The workflow sets the following runtime environment automatically:
- Secrets → `HOST_GOOGLE_API_KEY` is referenced from Secret Manager name `olexi-host-google-api-key` at `:latest` version.
- Env vars: `TOKEN_LIFETIME_HOURS=24`, `DAILY_REQUEST_LIMIT=50`, `HOURLY_REQUEST_LIMIT=10`

## What the workflow does
1. Authenticates to GCP using `GCP_SA_KEY`.
2. Builds the Docker image from `server/Dockerfile` using the repo root as context.
3. Pushes the image to Artifact Registry as `...:SHA` and `...:latest`.
4. Deploys the image to Cloud Run service `${CLOUD_RUN_SERVICE}` in `${GCP_REGION}`.
5. Prints the service URL and performs a basic health check on `/`.

## Notes
- The workflow is restricted to server file changes; edits to `webext/` will not trigger a deploy.
- Adjust the env vars or add more with `--set-env-vars` in the deploy step as needed.
- If you prefer Workload Identity Federation, replace `google-github-actions/auth` input with a workload identity provider and remove `GCP_SA_KEY`.
