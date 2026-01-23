# Updating citation metrics (Google Scholar + Scopus) for this website

This site is **static** and reads metrics from:
- `data/profile.json` (totals like citations, h-index, i10-index)
- `data/google_scholar_citations.json` (citations received per year)
- `data/scopus_citations.json` (citations received per year)

The JavaScript already supports these files. These scripts help you update them **without manually editing JSON**.

---

## 1) Google Scholar update (semi-automatic)

Google Scholar does **not** provide an official public API. The script uses the community library `scholarly`,
which may sometimes trigger Google anti-bot checks. If it fails, retry later or update the JSON manually.

### Install
```bash
pip install -r scripts/requirements.txt
```

### Run
```bash
python scripts/update_google_scholar.py
```

It will:
- read your Scholar `user` id from `data/profile.json` (`googleScholarUser`)
- update:
  - `data/google_scholar_citations.json`
  - `data/profile.json` → `googleScholar` totals

---

## 2) Scopus update (Elsevier API / pybliometrics)

Scopus data access is provided through Elsevier APIs and typically requires an API key.

### Configure pybliometrics
1. Get an Elsevier API key (institutional access may be required).
2. Configure pybliometrics (see pybliometrics documentation) so it can read your API key.
   Usually this means creating a config file with your API key.

### Run
```bash
python scripts/update_scopus.py
```

It will:
- read your Scopus Author ID from `data/profile.json` (`scopusAuthorId`)
- update:
  - `data/profile.json` → `scopus` totals (citations, documents, h-index)
- If it can compute citations-per-year, it will also update `data/scopus_citations.json`.
  (If not, it will leave your existing per-year file unchanged.)

---

## 3) Publish the update

After running a script:
1. commit the changed JSON files
2. push to GitHub Pages

Your published site will reflect the new numbers immediately.

---

## If you want "live" (auto) updates
You *can* automate these scripts with a GitHub Action, but:
- Scholar automation is often blocked by Google
- Scopus automation needs secure API-key storage

If you want, tell me your hosting (GitHub Pages / Netlify / other) and I will add an automation workflow safely.
