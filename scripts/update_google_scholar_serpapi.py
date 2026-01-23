#!/usr/bin/env python3
"""
Update Google Scholar metrics using SerpApi (google_scholar_author).

Reads:
  - data/profile.json:
      - googleScholarUser (or googleScholarUserId)
      - citationsChartStartYear (optional)

Writes:
  - data/google_scholar_citations.json
  - data/profile.json (updates googleScholar totals)

Env:
  - SERPAPI_KEY must be set in the terminal
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import requests

ROOT = Path(__file__).resolve().parents[1]
PROFILE_PATH = ROOT / "data" / "profile.json"
OUT_PATH = ROOT / "data" / "google_scholar_citations.json"

SERPAPI_URL = "https://serpapi.com/search.json"


def load_json(p: Path) -> Dict[str, Any]:
    return json.loads(p.read_text(encoding="utf-8"))


def save_json(p: Path, obj: Dict[str, Any]) -> None:
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def to_int(x: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        if x is None:
            return default
        return int(x)
    except Exception:
        return default


def extract_totals(result: Dict[str, Any]) -> Tuple[Optional[int], Optional[int], Optional[int], Optional[int], Optional[int], Optional[int]]:
    """
    Returns:
      citations_all, citations_since, h_all, h_since, i10_all, i10_since
    """
    cited_by = result.get("cited_by") or {}
    table = cited_by.get("table") or []

    citations_all = citations_since = h_all = h_since = i10_all = i10_since = None

    # SerpApi example shows:
    # table: [
    #   { "citations": { "all": 21934, "depuis_2016": 12302 } },
    #   { "indice_h": { "all": 45, "depuis_2016": 36 } },
    #   { "indice_i10": { "all": 59, "depuis_2016": 51 } }
    # ]
    for row in table:
        if not isinstance(row, dict):
            continue

        if "citations" in row and isinstance(row["citations"], dict):
            c = row["citations"]
            citations_all = to_int(c.get("all"), citations_all)
            # key name varies by locale; pick the first non-"all"
            for k, v in c.items():
                if k != "all":
                    citations_since = to_int(v, citations_since)
                    break

        if ("indice_h" in row or "h_index" in row) and isinstance(row.get("indice_h") or row.get("h_index"), dict):
            h = row.get("indice_h") or row.get("h_index")
            h_all = to_int(h.get("all"), h_all)
            for k, v in h.items():
                if k != "all":
                    h_since = to_int(v, h_since)
                    break

        if ("indice_i10" in row or "i10_index" in row) and isinstance(row.get("indice_i10") or row.get("i10_index"), dict):
            i10 = row.get("indice_i10") or row.get("i10_index")
            i10_all = to_int(i10.get("all"), i10_all)
            for k, v in i10.items():
                if k != "all":
                    i10_since = to_int(v, i10_since)
                    break

    return citations_all, citations_since, h_all, h_since, i10_all, i10_since


def extract_year_graph(result: Dict[str, Any]) -> Dict[int, int]:
    cited_by = result.get("cited_by") or {}
    graph = cited_by.get("graph") or []
    out: Dict[int, int] = {}
    for row in graph:
        if not isinstance(row, dict):
            continue
        y = to_int(row.get("year"))
        c = to_int(row.get("citations"), 0) or 0
        if y is None:
            continue
        out[y] = int(c)
    return out


def main() -> None:
    api_key = os.getenv("SERPAPI_KEY")
    if not api_key:
        print("ERROR: SERPAPI_KEY is not set in this terminal.")
        sys.exit(1)

    if not PROFILE_PATH.exists():
        print(f"ERROR: profile.json not found at {PROFILE_PATH}")
        sys.exit(1)

    profile = load_json(PROFILE_PATH)

    # Accept either key name
    author_id = str(profile.get("googleScholarUser") or profile.get("googleScholarUserId") or "").strip()
    if not author_id:
        print("ERROR: Missing googleScholarUser (or googleScholarUserId) in data/profile.json")
        sys.exit(1)

    start_year = to_int(profile.get("citationsChartStartYear"), 2020) or 2020

    params = {
        "engine": "google_scholar_author",
        "author_id": author_id,
        "hl": "en",
        "api_key": api_key,
        "no_cache": "false",
    }

    r = requests.get(SERPAPI_URL, params=params, timeout=60)
    if r.status_code != 200:
        print(f"ERROR: SerpApi request failed: {r.status_code} {r.text[:400]}")
        sys.exit(1)

    data = r.json()

    status = (data.get("search_metadata") or {}).get("status")
    if status and status != "Success":
        err = (data.get("error") or (data.get("search_metadata") or {}).get("error") or "Unknown error")
        print(f"ERROR: SerpApi status={status}: {err}")
        sys.exit(1)

    citations_all, citations_since, h_all, h_since, i10_all, i10_since = extract_totals(data)
    year_map = extract_year_graph(data)

    # Fill missing years so your chart always includes 2020..currentYear
    current_year = date.today().year
    for y in range(start_year, current_year + 1):
        year_map.setdefault(y, 0)

    years_sorted = sorted(year_map.keys())
    citations_by_year = {str(y): int(year_map[y]) for y in years_sorted}
    arr = [{"year": y, "citations": int(year_map[y])} for y in years_sorted]

    payload = {
        "lastUpdated": date.today().isoformat(),
        "method": "serpapi_google_scholar_author",
        "authorId": author_id,
        "totals": {
            "citationsAll": citations_all,
            "citationsSince": citations_since,
            "hIndexAll": h_all,
            "hIndexSince": h_since,
            "i10IndexAll": i10_all,
            "i10IndexSince": i10_since,
        },
        "citationsByYear": citations_by_year,
        "data": arr,
    }

    save_json(OUT_PATH, payload)

    # Update profile.json to use ALL totals (so your badge updates)
    profile.setdefault("googleScholar", {})
    if citations_all is not None:
        profile["googleScholar"]["citations"] = int(citations_all)
    if h_all is not None:
        profile["googleScholar"]["hIndex"] = int(h_all)
    if i10_all is not None:
        profile["googleScholar"]["i10Index"] = int(i10_all)

    # Keep "since" info if you want it later
    if citations_since is not None:
        profile["googleScholar"]["citationsSince"] = int(citations_since)
    if h_since is not None:
        profile["googleScholar"]["hIndexSince"] = int(h_since)
    if i10_since is not None:
        profile["googleScholar"]["i10IndexSince"] = int(i10_since)

    save_json(PROFILE_PATH, profile)

    print("✅ SUCCESS")
    print(f"Updated: {OUT_PATH.relative_to(ROOT)}")
    print(f"Updated: {PROFILE_PATH.relative_to(ROOT)} (googleScholar totals)")
    print("Google Scholar totals (ALL):", {"citations": citations_all, "hIndex": h_all, "i10Index": i10_all})
    print("Years covered:", (years_sorted[0], years_sorted[-1]) if years_sorted else "none")


if __name__ == "__main__":
    main()
