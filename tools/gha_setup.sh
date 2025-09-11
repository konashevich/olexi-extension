#!/usr/bin/env bash
set -euo pipefail

# This script configures GitHub Actions variables and secrets required by
# .github/workflows/deploy-server.yml using the GitHub CLI (gh).
#
# Usage:
#   export GCP_PROJECT_ID=olexi-extension
#   export GCP_REGION=australia-southeast1
#   export GAR_LOCATION=australia-southeast1
#   export GAR_REPOSITORY=olexi-ext
#   export CLOUD_RUN_SERVICE=olexi-extension-host
#   export CLOUD_RUN_SA=olexi-extension-host-runner@olexi-extension.iam.gserviceaccount.com
#   export GCP_SA_KEY_FILE=path/to/sa-key.json   # or set GCP_SA_KEY with JSON content
#   ./tools/gha_setup.sh [-r owner/repo]
#
# Requirements:
#   - gh CLI authenticated to GitHub with repo admin rights

REPO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -r|--repo)
      REPO="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,40p' "$0"; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required. Install from https://cli.github.com/" >&2
  exit 1
fi

if [[ -z "$REPO" ]]; then
  # Try to infer from the current git remote
  if git remote get-url origin >/dev/null 2>&1; then
    url=$(git remote get-url origin)
    # Supports SSH and HTTPS remotes
    if [[ "$url" =~ github.com[:/](.+)/(.+)\.git$ ]]; then
      REPO="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
    fi
  fi
fi

if [[ -z "$REPO" ]]; then
  echo "Could not infer owner/repo. Pass with --repo owner/repo." >&2
  exit 1
fi

echo "Configuring GitHub repository: $REPO"

require() { if [[ -z "${!1:-}" ]]; then echo "Missing required env: $1" >&2; exit 1; fi; }

require GCP_PROJECT_ID
require GCP_REGION
require GAR_LOCATION
require GAR_REPOSITORY
require CLOUD_RUN_SERVICE
require CLOUD_RUN_SA

echo "> Setting repository variables..."
gh variable set GCP_PROJECT_ID --repo "$REPO" --body "$GCP_PROJECT_ID"
gh variable set GCP_REGION --repo "$REPO" --body "$GCP_REGION"
gh variable set GAR_LOCATION --repo "$REPO" --body "$GAR_LOCATION"
gh variable set GAR_REPOSITORY --repo "$REPO" --body "$GAR_REPOSITORY"
gh variable set CLOUD_RUN_SERVICE --repo "$REPO" --body "$CLOUD_RUN_SERVICE"
gh variable set CLOUD_RUN_SA --repo "$REPO" --body "$CLOUD_RUN_SA"

echo "> Setting secret GCP_SA_KEY..."
if [[ -n "${GCP_SA_KEY_FILE:-}" && -f "$GCP_SA_KEY_FILE" ]]; then
  gh secret set GCP_SA_KEY --repo "$REPO" < "$GCP_SA_KEY_FILE"
elif [[ -n "${GCP_SA_KEY:-}" ]]; then
  printf "%s" "$GCP_SA_KEY" | gh secret set GCP_SA_KEY --repo "$REPO"
else
  echo "Missing GCP_SA_KEY_FILE or GCP_SA_KEY; cannot set secret." >&2
  exit 1
fi

echo "All set. Workflow will run on push to main affecting server files."
