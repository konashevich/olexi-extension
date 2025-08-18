# Olexi AI — Chrome Extension (WebExt)

This folder contains the entire Chrome extension ready for loading and publishing.

- Load unpacked: point Chrome/Edge to this `webext/` folder.
- The content script talks to the host backend at `http://127.0.0.1:3000` by default (override via `window.OLEXI_HOST_URL`).
- See `privacy.html` and `PRIVACY.md` for privacy terms.

Development notes
- Ensure the host server is running (see `../server/`).
- After changes here, click Reload in chrome://extensions for the extension.
