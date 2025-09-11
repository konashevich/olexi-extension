#!/usr/bin/env python3
"""
Chrome Web Store upload/publish script.

Usage:
  python3 tools/cws_publish.py --zip dist/webext-release.zip [--extension-id <ID>] [--dry-run]

Environment variables required:
  CWS_CLIENT_ID       OAuth2 client ID
  CWS_CLIENT_SECRET   OAuth2 client secret
  CWS_REFRESH_TOKEN   OAuth2 refresh token (with chromewebstore scope)

Notes:
  - If --extension-id is omitted, this will create a new draft item on first upload
    and print the generated ID. You should save that ID and use it for future updates.
  - The API does not upload screenshots or listing text; set those in the Developer Dashboard.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional

try:
    import requests  # type: ignore
except Exception:
    print("This script requires the 'requests' package. Install it with: pip install requests", file=sys.stderr)
    raise


OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
CWS_UPLOAD_URL_BASE = "https://www.googleapis.com/upload/chromewebstore/v1.1/items"
CWS_URL_BASE = "https://www.googleapis.com/chromewebstore/v1.1/items"


def get_access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    resp = requests.post(OAUTH_TOKEN_URL, data=data, timeout=30)
    resp.raise_for_status()
    tok = resp.json().get("access_token")
    if not tok:
        raise RuntimeError(f"No access_token in response: {resp.text}")
    return tok


def upload_zip(zip_path: Path, token: str, extension_id: Optional[str]) -> dict:
    headers = {"Authorization": f"Bearer {token}", "x-goog-api-version": "2"}
    with zip_path.open("rb") as f:
        if extension_id:
            url = f"{CWS_UPLOAD_URL_BASE}/{extension_id}"
            r = requests.put(url, headers=headers, data=f, timeout=120)
        else:
            url = CWS_UPLOAD_URL_BASE
            r = requests.post(url, headers=headers, data=f, timeout=120)
    r.raise_for_status()
    return r.json()


def publish_item(item_id: str, token: str) -> dict:
    headers = {"Authorization": f"Bearer {token}", "x-goog-api-version": "2"}
    # target param evolved; default should publish to public listing when approved
    url = f"{CWS_URL_BASE}/{item_id}/publish?publishTarget=default"
    r = requests.post(url, headers=headers, timeout=60)
    if r.status_code == 400:
        # Fallback to older 'target' param
        url = f"{CWS_URL_BASE}/{item_id}/publish?target=default"
        r = requests.post(url, headers=headers, timeout=60)
    r.raise_for_status()
    return r.json()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True, help="Path to the packaged ZIP")
    ap.add_argument("--extension-id", help="Existing extension ID (omit to create a new item)")
    ap.add_argument("--dry-run", action="store_true", help="Print actions without calling the API")
    args = ap.parse_args()

    zip_path = Path(args.zip).resolve()
    if not zip_path.exists():
        print(f"ZIP not found: {zip_path}", file=sys.stderr)
        return 2

    if args.dry_run:
        print("[DRY RUN] Would obtain access token and upload/publish:")
        print(f"  ZIP: {zip_path}")
        print(f"  Extension ID: {args.extension_id or '(new)'}")
        return 0

    client_id = os.getenv("CWS_CLIENT_ID")
    client_secret = os.getenv("CWS_CLIENT_SECRET")
    refresh_token = os.getenv("CWS_REFRESH_TOKEN")
    missing = [k for k, v in {
        "CWS_CLIENT_ID": client_id,
        "CWS_CLIENT_SECRET": client_secret,
        "CWS_REFRESH_TOKEN": refresh_token,
    }.items() if not v]
    if missing:
        print("Missing credentials: " + ", ".join(missing), file=sys.stderr)
        print("Set them in your environment. See docs/publish_via_api.md.")
        return 2

    # Cast to str after validation for type checkers
    client_id = str(client_id)
    client_secret = str(client_secret)
    refresh_token = str(refresh_token)

    token = get_access_token(client_id, client_secret, refresh_token)
    up = upload_zip(zip_path, token, args.extension_id)
    print("Upload response:")
    print(json.dumps(up, indent=2))
    # Determine item id
    item_id = up.get("id") or args.extension_id
    if not item_id:
        print("Could not determine item id from upload response.", file=sys.stderr)
        return 2
    pub = publish_item(item_id, token)
    print("Publish response:")
    print(json.dumps(pub, indent=2))
    print(f"Done. Item ID: {item_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
