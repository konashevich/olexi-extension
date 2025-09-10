#!/usr/bin/env python3
"""
Package the Chrome extension for store upload.

Creates webext-release.zip with prod-only permissions and a bumped version
from manifest.release.json, copying it to manifest.json temporarily for zipping.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
WEBEXT = ROOT / "webext"
OUTDIR = ROOT / "dist"
OUTZIP = OUTDIR / "webext-release.zip"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", help="Override version for release manifest (e.g., 1.0.2)")
    args = parser.parse_args()

    if not WEBEXT.exists():
        print(f"Missing webext folder at {WEBEXT}", file=sys.stderr)
        return 2

    release_manifest = WEBEXT / "manifest.release.json"
    base_manifest = WEBEXT / "manifest.json"
    if not release_manifest.exists():
        print("manifest.release.json not found; create it first", file=sys.stderr)
        return 2

    with release_manifest.open("r", encoding="utf-8") as f:
        rel = json.load(f)

    if args.version:
        rel["version"] = args.version

    # Validate minimal manifest fields
    for key in ("manifest_version", "name", "version", "action", "icons", "content_scripts"):
        if key not in rel:
            print(f"Release manifest missing required key: {key}", file=sys.stderr)
            return 2

    # Write a temporary manifest.json and optionally inject client token
    tmp_manifest = None
    tmp_content_js = None
    content_js_path = WEBEXT / "content.js"
    try:
        tmp_manifest = base_manifest.read_text("utf-8") if base_manifest.exists() else None
        with base_manifest.open("w", encoding="utf-8") as f:
            json.dump(rel, f, indent=2)

        # Optional token injection for auth
        client_token = os.getenv("CLIENT_TOKEN")
        if client_token and content_js_path.exists():
            original = content_js_path.read_text("utf-8")
            tmp_content_js = original
            replaced = original.replace("__CLIENT_TOKEN__", client_token)
            content_js_path.write_text(replaced, encoding="utf-8")

        OUTDIR.mkdir(parents=True, exist_ok=True)

        # Build ZIP of webext directory contents only
        with ZipFile(OUTZIP, "w", compression=ZIP_DEFLATED) as z:
            for p in WEBEXT.rglob("*"):
                if p.is_dir():
                    continue
                # No source control artifacts
                if any(part.startswith(".") for part in p.relative_to(WEBEXT).parts):
                    continue
                # Exclude release manifest helper file from the package
                if p.name == "manifest.release.json":
                    continue
                # Include everything in webext
                arcname = str(p.relative_to(WEBEXT))
                z.write(str(p), arcname)

        print(f"Created {OUTZIP}")
        return 0
    finally:
        # Restore original manifest.json if it existed
        if tmp_manifest is not None:
            with base_manifest.open("w", encoding="utf-8") as f:
                f.write(tmp_manifest)
        else:
            # Best effort: if we created manifest.json, remove it (unlikely since it existed)
            pass
        # Restore original content.js if modified
        if tmp_content_js is not None:
            content_js_path.write_text(tmp_content_js, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
