# Olexi Extension Host — Production Hardening Plan

This document tracks post-launch hardening steps for the Cloud Run–hosted Extension Host.

Scope
- CORS lockdown for Chrome extension origins
- Cold-start mitigation (min instances)
- Autoscaling and concurrency tuning
- Secrets management and key rotation
- Monitoring, logging, and alerts

## 1) CORS lockdown
Current: CORS allows all origins by default. Server supports env-based lockdown.

Config options (env vars)
- ALLOWED_ORIGINS: comma-separated exact origins
  Example: `chrome-extension://<EXT_ID>,https://<your-domain>`
- ALLOWED_ORIGIN_REGEX: optional regex for dynamic subdomains

Action
- After publishing the extension, update the Cloud Run service with ALLOWED_ORIGINS to include only:
  - chrome-extension://<EXTENSION_ID>
  - (optional) any admin or preview domains

Risk/Impact
- If the extension ID changes between Chrome Web Store channels (dev/beta/prod), include all active IDs.

## 2) Cold-start mitigation (min instances)
Current: min instances = 0 (scale-to-zero).

Recommendation
- Set `--min-instances=1` for snappier first load (small monthly cost). Keep `--max-instances` modest initially (e.g., 5).

## 3) Autoscaling and concurrency
Defaults are fine for initial traffic. Consider:
- `--concurrency=80` (Cloud Run default) or reduce to ~20 if responses include long SSE streams.
- CPU: `--cpu=1` is fine; consider `--cpu-boost` (requests-only) for lower latency.

## 4) Secrets management and key rotation
- HOST_GOOGLE_API_KEY is stored in Secret Manager as `olexi-host-google-api-key`.
- Runtime SA: `olexi-extension-host-runner@…` has roles/secretmanager.secretAccessor.
- Rotation playbook: add a new secret version; redeploy pins to `latest`.

## 5) Monitoring and Alerts
- Enable Cloud Monitoring dashboards:
  - Request count, latency, error rate for service `olexi-extension-host`.
- Log-based metrics:
  - 5xx errors from Cloud Run revisions
- Alerting policies:
  - Error rate > 2% for 5m
  - P95 latency > 2s for 10m

## 6) Security
- Public access is required for the extension. Keep CORS tight.
- Consider a simple allowlist header for API keys if needed in the future.
- Keep the base image updated on dependency bumps (rebuild monthly or on CVE alerts).

## 7) Change Management
- All changes go via PRs to `redesign-to-mcp-native` and tagged releases.
- Update this plan as steps are completed.

## Rollout Checklist
- [ ] Set ALLOWED_ORIGINS after Chrome Web Store publish
- [ ] Increase min instances to 1
- [ ] Review autoscaling and concurrency under real traffic
- [ ] Configure monitoring dashboards and alerts
- [ ] Confirm secret access and rotation SOP

---
Owner: Platform
Last updated: 2025-08-18
