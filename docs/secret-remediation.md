# Secret exposure remediation (public repo)

Your repository briefly contained a real API key in `server/.env`. Follow these steps to fix and harden:

## 1) Remove the file from the repo (done)
- We deleted `server/.env` and added `.gitignore` to prevent re-adding it.

## 2) Rotate exposed keys immediately
- Replace the leaked `HOST_GOOGLE_API_KEY` in the provider (Google AI) dashboard.
- Update Google Secret Manager with the new key:
  - In GCP Console → Security → Secret Manager → `olexi-host-google-api-key` → Add new version with the new value.
  - No code changes needed; Cloud Run uses the latest secret version.

## 3) Clean git history (optional but recommended for public repos)
- If the key was pushed to a public repo, scrub it from history:
  - Use GitHub’s guidance or tools like `git filter-repo`:
    ```bash
    pip install git-filter-repo
    git filter-repo --path server/.env --invert-paths
    git push --force --tags origin main
    ```
  - Consider invalidating all forks (cannot be enforced) and assume the old key is compromised.

## 4) Local development
- Use `server/.env.example` as a template and keep the real `.env` only on your machine.
- Never commit real secrets. `.gitignore` blocks common patterns, but stay vigilant.

## 5) Production secret handling
- Cloud Run receives `HOST_GOOGLE_API_KEY` from Secret Manager: `olexi-host-google-api-key:latest`.
- The CI/CD workflow deploys with OIDC (no long-lived GitHub keys) and references the secret at deploy/runtime.

## 6) Verify and test
- After rotation, run a quick smoke request to the service.
- If requests fail with auth errors, confirm the latest secret version is active and the Cloud Run service account has `secretAccessor` on that secret.

## 7) Prevent future leaks
- Keep `.env` out of version control.
- Consider pre-commit hooks to detect secrets (e.g., `detect-secrets`).
