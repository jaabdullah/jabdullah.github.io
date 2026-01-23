#!/usr/bin/env python3
"""Update Google Scholar metrics JSON files for the website.

Reads:
  - data/profile.json (expects: googleScholarUser)

Writes:
  - data/google_scholar_citations.json
  - data/profile.json (updates: googleScholar.*)

Notes:
  - Google Scholar has no official public API.
  - This uses the community 'scholarly' library and may sometimes be blocked (CAPTCHA).
"""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path
from typing import Dict, Any

def load_json(p: Path) -> Dict[str, Any]:
    return json.loads(p.read_text(encoding="utf-8"))

def save_json(p: Path, obj: Dict[str, Any]) -> None:
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    data_dir = repo_root / "data"
    profile_path = data_dir / "profile.json"
    gs_path = data_dir / "google_scholar_citations.json"

    profile = load_json(profile_path)
    user_id = (profile.get("googleScholarUser") or "").strip()
    if not user_id:
        raise SystemExit("Missing 'googleScholarUser' in data/profile.json (the value after ?user= in your Scholar URL).")

    try:
        from scholarly import scholarly  # type: ignore
    except Exception as e:
        raise SystemExit(f"Failed to import scholarly. Install requirements first. Details: {e}")

    # Fetch author by Scholar user id
    author = scholarly.search_author_id(user_id)
    author = scholarly.fill(author, sections=["basics", "indices", "counts"])

    citedby = int(author.get("citedby") or 0)
    citedby5y = int(author.get("citedby5y") or 0)
    hindex = int(author.get("hindex") or 0)
    hindex5y = int(author.get("hindex5y") or 0)
    i10 = int(author.get("i10index") or 0)
    i10_5y = int(author.get("i10index5y") or 0)

    # Citations per year (citations received per year)
    by_year = author.get("cites_per_year") or {}
    # ensure keys are strings to match site schema
    by_year_clean = {str(int(y)): int(by_year[y]) for y in by_year if str(y).isdigit()}

    today = date.today().isoformat()

    # Write per-year file
    save_json(gs_path, {
        "lastUpdated": today,
        "citationsByYear": dict(sorted(by_year_clean.items(), key=lambda kv: kv[0]))
    })

    # Update totals in profile.json (keep other keys intact)
    profile.setdefault("googleScholar", {})
    profile["googleScholar"].update({
        "citations": citedby,
        "citationsSince": citedby5y,
        # We keep 'sinceYear' as-is if present; otherwise set a sensible default
        "sinceYear": profile.get("googleScholar", {}).get("sinceYear", 2019),
        "hIndex": hindex,
        "hIndexSince": hindex5y,
        "i10Index": i10,
        "i10IndexSince": i10_5y,
    })

    save_json(profile_path, profile)

    print("✅ Updated:")
    print(f" - {gs_path.relative_to(repo_root)}")
    print(f" - {profile_path.relative_to(repo_root)} (googleScholar totals)")

if __name__ == "__main__":
    main()
