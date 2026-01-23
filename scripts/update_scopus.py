import json
import os
import sys
from pathlib import Path
from collections import defaultdict
from datetime import date

import requests

ROOT = Path(__file__).resolve().parents[1]
PROFILE_PATH = ROOT / "data" / "profile.json"
SCOPUS_BY_YEAR_PATH = ROOT / "data" / "scopus_citations.json"

SEARCH_URL = "https://api.elsevier.com/content/search/scopus"
HEADERS = {"Accept": "application/json"}


def h_index_from_citations(cites):
    cites_sorted = sorted((c for c in cites if c is not None), reverse=True)
    h = 0
    for i, c in enumerate(cites_sorted, start=1):
        if c >= i:
            h = i
        else:
            break
    return h


def scopus_search_all_docs(api_key: str, author_id: str, page_size: int = 25, max_docs: int = 5000):
    """
    Returns:
      total_results (int),
      citedby_counts (list[int]),
      entries (list[dict])  # includes cover dates and citedby-counts per doc
    """
    headers = dict(HEADERS)
    headers["X-ELS-APIKey"] = api_key

    query = f"AU-ID({author_id})"
    start = 0
    cited_counts = []
    all_entries = []

    # First call to get total results
    params = {"query": query, "count": page_size, "start": start, "view": "STANDARD"}
    r = requests.get(SEARCH_URL, headers=headers, params=params, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"Scopus Search failed: {r.status_code} {r.text[:300]}")
    data = r.json()
    total = int(data.get("search-results", {}).get("opensearch:totalResults", "0") or "0")

    # Iterate through pages
    while start < total and start < max_docs:
        params = {"query": query, "count": page_size, "start": start, "view": "STANDARD"}
        r = requests.get(SEARCH_URL, headers=headers, params=params, timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"Scopus Search failed at start={start}: {r.status_code} {r.text[:300]}")
        data = r.json()
        entries = data.get("search-results", {}).get("entry", []) or []
        all_entries.extend(entries)

        for e in entries:
            c = e.get("citedby-count")
            try:
                cited_counts.append(int(c))
            except Exception:
                cited_counts.append(0)

        start += page_size

    return total, cited_counts, all_entries


def extract_year(entry: dict):
    # Scopus Search commonly provides prism:coverDate like "2021-06-15"
    cover = entry.get("prism:coverDate") or entry.get("coverDate") or ""
    if isinstance(cover, str) and len(cover) >= 4 and cover[:4].isdigit():
        return int(cover[:4])
    return None


def to_int(x, default=0):
    try:
        return int(x)
    except Exception:
        return default


def main():
    api_key = os.getenv("ELSEVIER_API_KEY")
    if not api_key:
        print("ERROR: ELSEVIER_API_KEY is not set in this terminal.")
        sys.exit(1)

    if not PROFILE_PATH.exists():
        print(f"ERROR: profile.json not found at {PROFILE_PATH}")
        sys.exit(1)

    profile = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    author_id = str(profile.get("scopusAuthorId", "")).strip()
    if not author_id:
        print("ERROR: Missing scopusAuthorId in data/profile.json")
        sys.exit(1)

    total_docs, cited_counts, entries = scopus_search_all_docs(api_key, author_id, page_size=25)

    citations_total = int(sum(cited_counts))
    h_idx = int(h_index_from_citations(cited_counts))

    # --- Build "per-year" series (FAST proxy) ---
    # Groups citations by *publication year* (coverDate year).
    citations_by_pub_year = defaultdict(int)
    pubs_by_year = defaultdict(int)

    for e in entries:
        y = extract_year(e)
        if y is None:
            continue
        pubs_by_year[y] += 1
        citations_by_pub_year[y] += to_int(e.get("citedby-count"), 0)

    years_sorted = sorted(set(list(pubs_by_year.keys()) + list(citations_by_pub_year.keys())))

    # Update profile totals
    profile.setdefault("scopus", {})
    profile["scopus"]["documents"] = int(total_docs)
    profile["scopus"]["citations"] = citations_total
    profile["scopus"]["hIndex"] = h_idx

    PROFILE_PATH.write_text(json.dumps(profile, indent=2), encoding="utf-8")

    # Write scopus_citations.json in your site's expected shape
    years_map = {str(y): int(citations_by_pub_year.get(y, 0)) for y in years_sorted}
    data_array = [{"year": y, "citations": int(citations_by_pub_year.get(y, 0))} for y in years_sorted]

    payload = {
        "lastUpdated": date.today().isoformat(),
        "method": "grouped_by_publication_year_using_scopus_search",
        "citationsByYear": years_map,  # map schema expected by the site
        "data": data_array,            # fallback array schema
        "publicationsByYear": [
            {"year": y, "publications": int(pubs_by_year.get(y, 0))}
            for y in years_sorted
        ],
    }

    SCOPUS_BY_YEAR_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print("SUCCESS: updated data/profile.json and data/scopus_citations.json (fast per-year proxy)")
    print("Scopus totals:", {"documents": total_docs, "citations": citations_total, "hIndex": h_idx})
    print("Years covered:", (years_sorted[0], years_sorted[-1]) if years_sorted else "none")


if __name__ == "__main__":
    main()
