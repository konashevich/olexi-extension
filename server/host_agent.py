"""
Host-side agent for the extension host backend.

Plans a robust AustLII Boolean query and selects databases; summarises previews.
Uses Google GenAI SDK. Configure HOST_GOOGLE_API_KEY or GOOGLE_API_KEY in env.
"""
from __future__ import annotations

import os
import json
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv

load_dotenv()

try:
    from google import genai
    from google.genai import types
except Exception:  # pragma: no cover
    genai = None  # type: ignore
    types = None  # type: ignore


class HostAI:
    def __init__(self) -> None:
        self.available = False
        self.client = None
        host_key = os.getenv("HOST_GOOGLE_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if genai is None or types is None or not host_key:
            return
        os.environ.setdefault("GOOGLE_API_KEY", host_key)
        try:
            self.client = genai.Client()
            self.available = True
        except Exception:
            self.available = False

    def plan_search(self, user_prompt: str, database_tools: List[Dict[str, Any]], max_dbs: int = 5) -> Dict[str, Any]:
        if not self.available or self.client is None:
            raise RuntimeError("Host AI unavailable")
        tools_json = json.dumps(database_tools, indent=2)
        sys_prompt = (
            "You are a legal research planner for AustLII. Return STRICT JSON with keys exactly:\n"
            "{\"query\": string, \"databases\": string[]} and nothing else.\n\n"
            "Rules:\n"
            "- Build a robust AustLII Boolean query: use quotes for exact phrases; AND/OR/NOT; and ALWAYS use parentheses to group OR-alternatives.\n"
            "- Prefer gentle expansion: (stem* OR \"exact phrase\") where stem* is a reasonable stem of the key term. Avoid over-broad wildcards.\n"
            "- Do NOT use any SINO date operators (no date(), no \"date ><\", no \"date >=\", etc). If dates are implied, include plain years as terms (e.g., 2022 OR 2023) and leave filtering to the host.\n"
            "- Avoid proximity operators. Avoid punctuation besides parentheses and quotes.\n"
            f"- Select at most {max_dbs} database codes. Prefer specific court codes over broad masks unless user intent is ambiguous.\n"
            "- If the prompt implies federal/high court, bias to HCA, FCA, FCAFC; else choose the closest state/tribunal codes.\n"
            "- Do not add commentary. Output MUST be valid JSON with only the two keys above.\n\n"
            "Available databases (code, name, description):\n"
            f"{tools_json}\n"
        )
        kwargs: Dict[str, Any] = {
            "model": os.getenv("HOST_MODEL", "gemini-2.5-flash"),
            "contents": f"{sys_prompt}\n\nUser Request: {user_prompt}",
        }
        if types is not None:
            kwargs["config"] = types.GenerateContentConfig(response_mime_type="application/json")
        resp = self.client.models.generate_content(**kwargs)
        try:
            data = json.loads(resp.text or "{}")
        except Exception as e:
            raise RuntimeError(f"Invalid planner output: {e}")
        if not isinstance(data, dict) or "query" not in data or "databases" not in data:
            raise RuntimeError("Planner did not return required keys")
        if not isinstance(data["databases"], list):
            data["databases"] = []
        data["databases"] = data["databases"][:max_dbs]
        # Strip any accidental date() operators
        import re as _re
        q = str(data.get("query", ""))
        q = _re.sub(r"\bdate\s*\(.*?\)", " ", q, flags=_re.IGNORECASE)
        q = _re.sub(r"\bdate\s*>\<\s*\S+\s+\S+", " ", q, flags=_re.IGNORECASE)
        q = _re.sub(r"\bdate\s*(?:>=|<=|>|<)\s*\S+", " ", q, flags=_re.IGNORECASE)
        q = " ".join(q.split()) or "*"
        data["query"] = q
        return data

    def summarize(self, user_prompt: str, results: List[Dict[str, Any]]) -> str:
        if not self.available or self.client is None:
            raise RuntimeError("Host AI unavailable")
        sys_prompt = (
            "You are Olexi, a neutral legal research assistant. Summarise ONLY based on the provided results. "
            "Use British English. Return concise Markdown with sections: \n\n"
            "## Summary (≤120 words)\n\n"
            "## Key Cases (bulleted: [Title](URL) — court/year if available)\n\n"
            "## Notes/Next Steps (if data is thin, say so)\n\n"
            "## Questions you may want to explore further\n"
            "- Provide at least three succinct follow-up questions that would clarify or deepen the enquiry.\n"
            "- Make each question a Markdown link in the form [Question text](olexi://ask). Do NOT include any other URL.\n"
        )
        tool_str = json.dumps(results, indent=2)
        prompt = (
            f"{sys_prompt}\n\nUser question: {user_prompt}\n\n"
            f"Results JSON:\n{tool_str}"
        )
        resp = self.client.models.generate_content(model=os.getenv("HOST_MODEL", "gemini-2.5-flash"), contents=prompt)
        return resp.text or ""


HOST_AI = HostAI()
