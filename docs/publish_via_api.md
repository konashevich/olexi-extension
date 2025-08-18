# Publish to Chrome Web Store via API

Prereqs
- Ensure `dist/webext-release.zip` exists (run the packager first).
- Create an OAuth client in Google Cloud Console for the same account as your Chrome Developer account.
- Generate an OAuth refresh token with scope `https://www.googleapis.com/auth/chromewebstore`.

Environment variables
- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`

Upload and publish
1. Dry run:
   - python3 tools/cws_publish.py --zip dist/webext-release.zip --dry-run
2. First upload (no existing item):
   - python3 tools/cws_publish.py --zip dist/webext-release.zip
   - Save the printed Item ID for future updates.
3. Update existing item:
   - python3 tools/cws_publish.py --zip dist/webext-release.zip --extension-id <YOUR_ITEM_ID>

Notes
- The API does not set screenshots or listing text; do that once in the Developer Dashboard.
- After initial manual listing is complete, subsequent updates can be fully automated.
