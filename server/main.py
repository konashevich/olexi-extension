from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import urllib.parse
import os
import json
import asyncio

# MCP client utilities
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

# Host-side AI (planning & summarization)
from .host_agent import HOST_AI


app = FastAPI(title="Olexi Extension Host", version="1.0.0", description="Serves the extension UI and hosts research sessions via remote MCP")

# CORS for content scripts
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Optional static (for local splash/testing)
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", include_in_schema=False)
async def root():
    index_path = "static/index.html"
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    return {"status": "Olexi Extension Host running", "mcp": os.getenv("MCP_URL", "unset")}


class ResearchRequest(BaseModel):
    prompt: str
    maxResults: int = 25
    maxDatabases: int = 5
    yearFrom: Optional[int] = None
    yearTo: Optional[int] = None


def _build_austlii_url(query: str, dbs: List[str]) -> str:
    params = [("query", query), ("method", "boolean"), ("meta", "/au")]
    for code in dbs:
        params.append(("mask_path", code))
    return f"https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?{urllib.parse.urlencode(params)}"


@app.post("/session/research")
async def session_research(req: ResearchRequest):
    if not getattr(HOST_AI, "available", False):
        raise HTTPException(status_code=503, detail="Host AI unavailable; set HOST_GOOGLE_API_KEY or GOOGLE_API_KEY")

    async def event_stream():
        # Plan
        yield f"event: progress\ndata: {json.dumps({'stage':'planning','message':'Planning search'})}\n\n"
        from database_map import DATABASE_TOOLS_LIST  # import lazily to avoid heavy import on module load
        try:
            plan = HOST_AI.plan_search(req.prompt, DATABASE_TOOLS_LIST, max_dbs=max(req.maxDatabases, 1))
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'code':'PLANNING_FAILED','detail':str(e)})}\n\n"
            return

        query = plan.get("query", req.prompt)
        dbs: List[str] = list(plan.get("databases", []))[: req.maxDatabases]
        if not dbs:
            dbs = ["au/cases/cth/HCA", "au/cases/cth/FCA"]

        yield f"event: progress\ndata: {json.dumps({'stage':'planning','message':'Planned query','query': query, 'databases': dbs})}\n\n"

        # Adaptive method selection
        def _is_vague(p: str) -> bool:
            p = (p or "").lower()
            if len(p.split()) <= 3:
                return True
            hints = ["hca", "fca", "nsw", "vic", "qld", "tribunal", "since ", "after ", "before ", "between ", "[20", "(20"]
            return not any(h in p for h in hints)

        method = "auto" if _is_vague(req.prompt) else "boolean"
        yield f"event: progress\ndata: {json.dumps({'stage':'planning','message':'Adaptive mode selected','method': method})}\n\n"

        # Connect to remote MCP over Streamable HTTP
        mcp_url = os.getenv(
            "MCP_URL",
            # Default to the provided Cloud Run URL
            "https://olexi-mcp-root-au-691931843514.australia-southeast1.run.app/",
        )

        try:
            from asyncio import Queue
            queue: Queue[str] = Queue()
            result_holder: Dict[str, Any] = {}

            async def run_tool_call():
                try:
                    async with streamablehttp_client(mcp_url) as (read, write, _):
                        async with ClientSession(read, write) as session:
                            await session.initialize()

                            async def on_progress(progress: float, total: Optional[float], message: Optional[str]):
                                evt = {"stage": "search", "pct": progress, "message": message}
                                await queue.put(f"event: progress\ndata: {json.dumps(evt)}\n\n")

                            res = await session.call_tool(
                                "search_with_progress",
                                {"query": query, "databases": dbs, "method": method},
                                progress_callback=on_progress,
                            )
                            result_holder["result"] = res
                except Exception as e:
                    result_holder["error"] = e
                finally:
                    await queue.put("__DONE__")

            task = asyncio.create_task(run_tool_call())

            # Drain events
            while True:
                msg = await queue.get()
                if msg == "__DONE__":
                    break
                await asyncio.sleep(0)
                yield msg

            # Handle result
            if "error" in result_holder:
                raise result_holder["error"]  # type: ignore[misc]

            result: Any = result_holder.get("result")
            items_list: List[Dict] = []
            if result is not None and hasattr(result, "structuredContent") and getattr(result, "structuredContent", None):
                sc = getattr(result, "structuredContent", None)
                if isinstance(sc, list):
                    items_list = sc  # type: ignore[assignment]
                elif isinstance(sc, dict) and isinstance(sc.get("result"), list):
                    items_list = sc.get("result")  # type: ignore[assignment]
            if result is not None:
                for c in getattr(result, "content", []) or []:
                    try:
                        raw = getattr(c, "text", "") or ""
                        if not raw:
                            continue
                        obj = json.loads(raw)
                        if isinstance(obj, list):
                            if not items_list:
                                items_list = obj
                        elif isinstance(obj, dict) and isinstance(obj.get("result"), list):
                            if not items_list:
                                items_list = obj.get("result")  # type: ignore[assignment]
                    except Exception:
                        continue

            # Apply optional year filter
            def _extract_year(title: str) -> Optional[int]:
                import re as _re
                m = _re.search(r"\[(\d{4})]", title)
                if m:
                    return int(m.group(1))
                m2 = _re.search(r"\((?:\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\)", title)
                if m2:
                    return int(m2.group(2))
                return None

            unfiltered = items_list if isinstance(items_list, list) else []
            filtered: List[Dict] = []
            y_from = req.yearFrom
            y_to = req.yearTo
            if unfiltered and (y_from or y_to):
                for it in unfiltered:
                    t = str(it.get('title') or '')
                    y = _extract_year(t)
                    if y is None:
                        continue
                    if y_from and y < y_from:
                        continue
                    if y_to and y > y_to:
                        continue
                    filtered.append(it)
            else:
                filtered = unfiltered

            # Preview
            preview_items: List[Dict] = filtered[: max(1, min(10, req.maxResults))]
            yield f"event: results_preview\ndata: {json.dumps({'items': preview_items, 'total_unfiltered': len(unfiltered), 'total_filtered': len(filtered)})}\n\n"

            # Build shareable URL via tool
            share_url: Optional[str] = None
            try:
                async with streamablehttp_client(mcp_url) as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        url_res: Any = await session.call_tool("build_search_url", {"query": query, "databases": dbs})
                        if hasattr(url_res, "structuredContent") and getattr(url_res, "structuredContent", None):
                            sc = getattr(url_res, "structuredContent")
                            share_url = sc if isinstance(sc, str) else None
                        if not share_url:
                            for c in getattr(url_res, "content", []) or []:
                                if getattr(c, "type", "") == "text":
                                    share_url = getattr(c, "text", None)
                                    break
            except Exception:
                share_url = None

        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'code':'MCP_ERROR','detail':str(e)})}\n\n"
            return

        # Summarize
        try:
            markdown = HOST_AI.summarize(req.prompt, preview_items)
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'code':'SUMMARIZE_FAILED','detail':str(e)})}\n\n"
            return

        yield f"event: answer\ndata: {json.dumps({'markdown': markdown, 'url': share_url or _build_austlii_url(query, dbs)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

