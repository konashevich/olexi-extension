# Extension CI/CD

This repository includes a GitHub Actions workflow to automatically package and publish the Chrome extension when changes are pushed to `main` under `webext/**` or the packaging tools.

## What it does
- Packages `webext/` into `dist/webext-release.zip` using `tools/package_extension.py`.
- Uploads the zip as a build artifact.
- Publishes the zip to the Chrome Web Store using `tools/cws_publish.py`.
- If Chrome Web Store secrets are not configured, the workflow runs in `--dry-run` mode.

## Required secrets (in GitHub repository settings)
Set these in Settings → Secrets and variables → Actions → New repository secret:

- `CWS_CLIENT_ID` — OAuth client ID for the Chrome Web Store API.
- `CWS_CLIENT_SECRET` — OAuth client secret.
- `CWS_REFRESH_TOKEN` — Refresh token for an account with access to the store listing.
- `CWS_EXTENSION_ID` — Your published extension ID.

Optional:
- `EXTENSION_CLIENT_TOKEN` — injected as `CLIENT_TOKEN` during packaging if your content script expects it.

## How to obtain Chrome Web Store credentials
1. Create an OAuth Client (Web application) in Google Cloud Console under the same Google account used for the Chrome Web Store developer dashboard.
2. Add authorized redirect URIs required by the token tool you use to mint the refresh token.
3. Use an OAuth helper to request the `https://www.googleapis.com/auth/chromewebstore` scope and capture the refresh token.
4. Ensure the account has permission to upload/publish the target extension.

Refer to `tools/cws_publish.py` for required environment variables and API flow details.

## Triggering
Push any change under `webext/**` to `main` to trigger the workflow. You can also run it manually via the Actions tab (workflow_dispatch).
