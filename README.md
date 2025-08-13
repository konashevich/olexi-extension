# Olexi AI — Browser Extension (MCP Host)

A lightweight browser extension that acts as an MCP host UI for legal research on AustLII. The extension delegates all planning, tool invocation, and summarisation to the authorised backend host, which in turn calls an MCP server that exposes web tools (no AI in MCP).

## How it works (high level)
- Extension UI: Renders a compact panel on any page; streams progress and answers via SSE.
- Host backend (FastAPI): Orchestrates the session at `/session/research` (Server‑Sent Events). It plans the search, calls MCP tools, filters/aggregates results, summarises, and returns a shareable URL.
- MCP server: Exposes tools over Streamable HTTP mounted under `/mcp` (local). Provides search and utility tools only; no AI.

## Key features
- Adaptive search mode: Automatically uses `method=auto` for broad/unclear enquiries. Uses tuned search (Boolean with precise grouping and/or titles‑only) when scope is explicit or implied. Falls back across modes when empty or noisy.
- Method‑aware tools: The host passes `method` through MCP tools to the scraper (`boolean`, `auto`, or `title`).
- Robustness: Configurable retries/timeouts/back‑off for upstream requests; soft‑fail health checks proceed with a warning.
- Transparent preview: Streams planned query, selected databases, item counts, fallback usage, and method chosen.
- Shareable link: Always includes a direct AustLII results URL reflecting the query and databases.
- British English summaries: Neutral, concise Markdown with clear sections.
- Follow‑up questions: Each answer ends with “Questions you may want to explore further” (≥3 items). Questions are clickable and start a new session with that text.

## Security and privacy
- Authorisation: The host requires an API key; the extension stores it locally (browser storage/localStorage). The MCP endpoint remains local and unauthenticated, exposing only tools.
- Request checks: The host enforces origin/ID/UA checks and simple rate‑limits. No end‑user credentials are sent to AustLII.

## Extension usage
1. Open any page and toggle the Olexi panel.
2. Enter a research prompt (e.g., “Recent Federal Court cases on contracts”).
3. Watch streamed progress and a “Top results” preview.
4. Review the final summary and open the share link if needed.
5. Click a follow‑up question to instantly run a new query with that text.

Notes
- Broad prompts will start in `auto` mode to maximise recall; scoped prompts will favour Boolean/titles‑only for precision.
- The host avoids site‑specific date operators; optional year filters are applied host‑side from titles.

## Configuration
Backend environment variables (set in the host server):
- AUSTLII_TIMEOUT (default 20) — HTTP timeout (seconds)
- AUSTLII_RETRIES (default 3) — Number of retry attempts
- AUSTLII_BACKOFF (default 1.5) — Seconds to wait between retries
- AUSTLII_HEALTH_TIMEOUT (default 6) — Health probe timeout
- PREVIEW_STOPLIST — Comma‑separated words to exclude from preview items (optional)

Extension settings:
- API key is prompted on first use and stored locally. No external telemetry is sent.

## MCP basics
- Model Context Protocol (MCP) lets a host call tools over a standard interface. Here we use Streamable HTTP.
- Provided tools:
  - list_databases — discover available AustLII database codes
  - search_austlii(query, databases, method) — perform a search (boolean/auto/title)
  - search_with_progress(query, databases, method) — as above, with progress events
  - build_search_url(query, databases) — generate a shareable results URL
- The host mounts MCP under `/mcp` and manages sessions with progress reporting.

## Development
- Load the extension (Developer Mode in Chromium‑based browsers) from `olexi-extension/`.
- Start the host backend (FastAPI/uvicorn) from the project root; ensure `/session/research` and `/mcp` are reachable on `http://127.0.0.1:3000`.
- Ensure required Python dependencies are installed (see project `requirements.txt`).

## Limitations
- Upstream (AustLII) latency may vary; health probes can time out yet the session still proceeds.
- Titles‑only mode improves precision but may reduce recall.
- Only Australian collections (meta=/au) are used.

## Troubleshooting
- "No results" or thin previews: The host will fall back between modes; try a more specific prompt or click a follow‑up question.
- Health timeouts: A warning is shown, but the session continues. Consider increasing `AUSTLII_TIMEOUT` or `AUSTLII_HEALTH_TIMEOUT` in the host.
- Authorisation errors: Re‑enter the API key when prompted.

## License and attribution
- This extension is part of the Olexi AI project. AustLII content is subject to AustLII terms of use.
