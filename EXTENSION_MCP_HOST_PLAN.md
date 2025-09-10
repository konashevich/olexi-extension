# Olexi Chrome Extension — MCP Host Design (VS Code–style)

This document defines the correct, VS Code–like MCP host design for the Olexi Chrome Extension. It emphasizes strict isolation, agent-led orchestration, and a natural chat UX (no user-facing database selection in the primary flow).

## 1) Goals and constraints
- UX parity with VS Code MCP hosts: user asks in natural language; the host agent plans, invokes MCP tools, and returns grounded answers with citations.
- Isolation: MCP server provides tools only (no AI). Host agent (extension backend) uses its own AI key(s) for planning/summarization.
- Reliability: handle ambiguity, timeouts, quotas, and upstream health gracefully. Stream progress to the UI.
- Security: Prefer server-held credentials (no client API keys). Use origin checks and rate limits at the host if needed.

## 2) Architecture overview
- Frontend (content script on AustLII)
  - Minimal chat UI injected on austlii.edu.au.
  - Talks to the extension backend via a single stream endpoint for research sessions.
  - Renders streamed progress, optional clarifying question, and final answer with a link to full results.

- Backend (extension server acting as MCP host)
  - Implements an agent that plans and orchestrates MCP tool calls using its own AI key (HOST_GOOGLE_API_KEY).
  - Connects to the MCP server over Streamable HTTP (POST /mcp, Accept: application/json, text/event-stream), performs the MCP handshake, discovers tools, and invokes them directly.
  - Uses these MCP tools only:
    - list_databases (for planner grounding; cached)
    - search_with_progress (preferred) or search_austlii
    - build_search_url (always return a shareable link)
  - Streams tool progress and agent events to the frontend.

- MCP server (already implemented)
  - Tools only; no planning or summarization.
  - Mounted at /mcp with streamable HTTP and custom /mcp/health, /mcp/info.

## 3) Transport and event flow
- Backend ↔ MCP server
  - Streamable HTTP handshake: POST /mcp with Accept: "application/json, text/event-stream".
  - Tool invocation via JSON-RPC messages; progress events from search_with_progress are received and mapped to UI.

- Frontend ↔ Backend
  - A single research session stream (SSE or WebSocket; SSE recommended for simplicity).
  - Event types (JSON):
    - progress: { stage: string, pct?: number, message?: string }
    - clarify: { question: string }
    - results_preview: { items: Array<{ title, url, metadata? }> }
    - answer: { markdown: string, url: string }
    - error: { code: string, detail?: string }

## 4) Agent behavior (host-side)
- Planning
  - Read tool schemas/resources at startup (list_databases cached in memory).
  - Generate a strict JSON plan { query: string, databases: string[] }.
  - Rules: AustLII boolean syntax (quotes, AND/OR/NOT, parentheses, optional *), max ~5 DBs, prefer specific court codes over umbrella masks unless ambiguous.
  - If prompt is too broad or conflicting, emit a clarify event with one concise question; resume after the user reply.

- Execution
  - Invoke search_with_progress(query, databases) and map MCP progress to progress events.
  - Collect results; cap preview (e.g., top 10) for UI while retaining total count for messaging.
  - Call build_search_url(query, databases) and include in final answer.

- Summarization
  - Host-only (AI key owned by extension backend) with a constrained prompt:
    - Sections: "Summary" (≤120 words), "Key Cases" (bulleted with [Title](URL) — court/year), "Notes/Next Steps".
    - Grounded: cite only provided results; no legal advice.

## 5) UX principles
- Primary chat flow: no user-facing database picker. The agent chooses DBs.
- Clarifying question appears only when necessary (one-hop). User reply restarts the plan.
- Progress is real (forwarded from MCP search), not simulated.
- Answer is concise, linked, and reproducible (shareable results URL).
- Optional "Advanced" panel (collapsed by default) for power users (timeouts, max results). Keep off by default.

## 6) Reliability and performance
- Health gating: probe AustLII before heavy operations; fail fast with a helpful message.
- Quotas: surface remaining/day in logs; respect per-key caps and use exponential backoff on transient errors.
- Caching: list_databases cached in memory; optional short-TTL cache for (query, dbs) → results to speed follow-ups.
- Dedupe and limit: present top N in UI; always include the full results URL.

## 7) Security and isolation
- Separate keys: HOST_GOOGLE_API_KEY (host agent) distinct from extension REST keys. MCP server never uses AI keys.
- Continue enforcing: X-Extension-Id (optional), UA/origin checks, and rate limits as appropriate.
- Logging: rotate security events and summarize usage metrics (counts/latencies) without PII.

## 8) Implementation phases
- Phase 1: Host agent skeleton and streaming
  - Implement Streamable HTTP MCP client in backend with handshake and tool discovery.
  - Add /session/research (SSE) in backend that runs: plan → MCP search_with_progress → summarize → build URL; stream events to UI.
  - Frontend consumes the stream and renders progress/clarify/answer.

- Phase 2: Hardening
  - Health checks, retries/backoff, structured error mapping, short-TTL caching, and metrics.
  - Clarify loop, end-to-end tests, and timeboxed execution (timeouts with graceful messaging).

- Phase 3: Polish
  - Optional advanced settings (hidden), copy/share of the full results URL, telemetry dashboards.
  - A/B tuning: max DBs, planner strictness, and summarizer length.

## 9) Prompts (host-side reference)
- Planner (strict JSON)
  - Return only: { "query": string, "databases": string[] }.
  - AustLII boolean, max 5 DBs, prefer specific courts; use umbrella masks only if scope unclear.

- Summarizer
  - Markdown with sections: Summary (≤120 words), Key Cases (bulleted with links), Notes/Next Steps.
  - Grounded to provided results only; no legal advice.

## 10) What we will NOT do
- No user-facing database picker in the primary UX.
- No composite orchestration endpoints in MCP. Tools remain atomic.
- No MCP-side AI usage. All AI stays on the host agent side.

---
Status: plan approved as target. The current helper feature is disabled by default (HOST_AGENT_ENABLED=0). Next steps are to implement Phase 1 (MCP client handshake, tool discovery, and SSE stream to the UI).
