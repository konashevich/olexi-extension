"""
Host-side agent moved under olexi-extension/server for future work.
"""
from __future__ import annotations

import os
import json
from typing import Dict, List, Any
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
        raise NotImplementedError("Moved host; implement later")

    def summarize(self, user_prompt: str, results: List[Dict[str, Any]]) -> str:
        raise NotImplementedError("Moved host; implement later")


HOST_AI = HostAI()
