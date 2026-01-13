const EMAIL_CONTACT = "jabdullah@us.es";
let PUB_ORCID = ""; // configured in /data/profile.json

async function loadProfile() {
  // Fetching local JSON via `file://` is blocked in most browsers.
  // If you are opening index.html directly, run a local server (VSCode Live Server or `python -m http.server`).
  if (window.location && window.location.protocol === "file:") {
    return { __error: "file_protocol" };
  }
  try {
    const r = await fetch("data/profile.json", { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return { __error: "fetch_failed", __detail: String(e && e.message ? e.message : e) };
  }
}

const pubBody = document.getElementById("pubBody");
const searchInput = document.getElementById("pubSearch");
const typeSelect = document.getElementById("pubType");
const sortYearBtn = document.getElementById("sortYear");
const sortCitationsBtn = document.getElementById("sortCitations");
let currentSort = "year"; // default: newest first


let allRows = []; // cached normalized items

function upsertAddition(rows, add) {
  if (!add?.title) return rows;
  const titleKey = String(add.title);
  const urlKey = add.url ? String(add.url) : null;
  const idx = rows.findIndex(r => String(r.title || "") === titleKey || (urlKey && String(r.url || "") === urlKey));
  if (idx === -1) {
    rows.push({
      title: add.title,
      year: add.year || null,
      source: add.source || "",
      doi: add.doi || null,
      url: add.url || "",
      type: add.type || "other",
      typeLabel: add.typeLabel || openalexTypeLabel(add.type)
    });
    return rows;
  }

  // If it already exists and the addition is marked as force, update the existing entry.
  if (add.force) {
    rows[idx] = {
      ...rows[idx],
      title: add.title || rows[idx].title,
      year: add.year || rows[idx].year,
      source: add.source || rows[idx].source,
      doi: add.doi ?? rows[idx].doi,
      url: add.url || rows[idx].url,
      type: add.type || rows[idx].type,
      typeLabel: add.typeLabel || openalexTypeLabel(add.type) || rows[idx].typeLabel
    };
  }
  return rows;
}

async function loadPublicationOverrides() {
  try {
    const r = await fetch(`data/publication_overrides.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return { overrides: [], additions: [] };
    const j = await r.json();
    return { overrides: j.overrides || [], additions: j.additions || [] };
  } catch {
    return { overrides: [], additions: [] };
  }
}

function applyPublicationOverrides(rows, overrides) {
  const out = rows.map(r => ({ ...r }));
  for (const rule of (overrides || [])) {
    const match = rule?.match || {};
    const set = rule?.set || {};
    for (const p of out) {
      const title = String(p.title || "");
      const url = String(p.url || "");
      // More robust matching: case-insensitive + accent-insensitive substring
      const norm = (s) => String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const titleOk = match.title_contains ? norm(title).includes(norm(match.title_contains)) : true;
      const urlOk = match.url ? url === match.url : true;
      const doiOk = match.doi ? String(p.doi || "") === String(match.doi) : true;
      if (titleOk && urlOk && doiOk) Object.assign(p, set);
    }
  }
  return out;
}

function normalizeType(orcidType) {
  // PUB_ORCID uses "journal-article", "conference-paper", etc. (varies)
  if (!orcidType) return "other";
  const t = String(orcidType).toLowerCase();
  // We normalize everything to OpenAlex-style work types so filtering is consistent.
  if (t.includes("journal")) return "article";
  if (t.includes("review")) return "review";
  if (t.includes("conference") || t.includes("proceedings")) return "proceedings-article";
  if (t.includes("book-chapter")) return "book-chapter";
  if (t.includes("dissertation") || t.includes("thesis")) return "dissertation";
  if (t.includes("book")) return "book";
  if (t.includes("preprint")) return "preprint";
  return "other";
}

function doiFromUrl(url) {
  if (!url) return null;
  // Typical DOI URL: https://doi.org/10.xxxx/xxxx
  const m = String(url).match(/10\.\d{4,9}\/[-._;()\/:A-Z0-9]+/i);
  return m ? m[0] : null;
}


async function loadMetricOverrides() {
  try {
    // Optional local file to override specific years (e.g., align with Google Scholar)
    const r = await fetch(`data/metrics_override.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function applyOverridesToCounts(countsByYear, overrides) {
  if (!overrides?.citationsByYearOverrides) return countsByYear;
  const map = new Map((countsByYear || []).map(x => [String(x.year), { ...x }]));
  for (const [year, val] of Object.entries(overrides.citationsByYearOverrides)) {
    const y = String(year);
    const item = map.get(y) || { year: Number(y) };
    item.cited_by_count = Number(val);
    map.set(y, item);
  }
  // return sorted array
  return Array.from(map.values()).sort((a,b)=>a.year-b.year);
}

async function fetchJson(url, headers = {}) {
  // Add a timeout so the UI doesn't get stuck forever on slow/blocked networks.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  const r = await fetch(url, { headers, signal: controller.signal });
  clearTimeout(t);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function typeLabel(t) {
  // Labels for PUB_ORCID/Crossref types (fallback path)
  const map = {
    "article": "Article",
    "review": "Review",
    "proceedings-article": "Conference paper",
    "posted-content": "Preprint",
    "book-chapter": "Book chapter",
    "dissertation": "Thesis",
    "book": "Book",
    "preprint": "Preprint",
    other: "Other"
  };
  const key = String(t || "other").toLowerCase();
  return map[key] || key.replaceAll("-", " ");
}

async function crossrefMeta(doi) {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const data = await fetchJson(url, { "Accept": "application/json" });
  const item = data?.message;
  if (!item) return null;

  const year =
    item?.published?.["date-parts"]?.[0]?.[0] ||
    item?.issued?.["date-parts"]?.[0]?.[0] ||
    null;

  return {
    source: item["container-title"]?.[0] || "",
    year,
    type: item.type || "",
    url: item.URL || (doi ? `https://doi.org/${doi}` : "")
  };
}

function render(rows) {
  if (!rows.length) {
    pubBody.innerHTML = `<tr><td colspan="6" class="muted">No results.</td></tr>`;
    return;
  }

  pubBody.innerHTML = rows.map(r => {
    const title = r.url
      ? `<a class="pubTitle" href="${r.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(stripTags(r.title || "Untitled"))}</a>`
      : escapeHtml(stripTags(r.title || "Untitled"));

    const doiLink = r.doi
      ? `<a class="pubDoi" href="https://doi.org/${r.doi}" target="_blank" rel="noopener noreferrer">${r.doi}</a>`
      : `<span class="muted">—</span>`;

    return `
      <tr>
        <td>${escapeHtml(r.typeLabel)}</td>
        <td>${escapeHtml(String(r.year || "—"))}</td>
        <td>${title}</td>
        <td>${escapeHtml(r.source || "—")}</td>
        <td class="num">${escapeHtml(String((r.citations ?? 0)))}</td>
        <td>${doiLink}</td>
      </tr>
    `;
  }).join("");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripTags(s){
  return String(s ?? "").replace(/<[^>]*>/g, "");
}


function sortRows(rows){
  const list = [...rows];
  if (currentSort === "citations") {
    list.sort((a,b) => (Number(b.citations||0) - Number(a.citations||0)) ||
      (Number(b.year||0) - Number(a.year||0)) ||
      String(a.title||"").localeCompare(String(b.title||"")));
  } else {
    list.sort((a,b) => (Number(b.year||0) - Number(a.year||0)) ||
      String(a.title||"").localeCompare(String(b.title||"")));
  }
  return list;
}

function setSort(mode){
  currentSort = mode;
  if (sortYearBtn && sortCitationsBtn) {
    sortYearBtn.classList.toggle("is-active", mode === "year");
    sortCitationsBtn.classList.toggle("is-active", mode === "citations");
  }
  applyFilters();
}

function applyFilters() {
  const q = (searchInput.value || "").toLowerCase().trim();
  const t = String(typeSelect.value || "all").toLowerCase();

  const known = ["article","review","proceedings-article","book-chapter","dissertation","book","preprint"];

  const filtered = allRows.filter(r => {
    // Defensive normalization: some sources (or overrides) may carry non-normalized types
    const rowType = normalizeOAType(r?.type || r?.typeLabel || "");

    const matchesType = (t === "all")
      ? true
      : (t === "other")
        ? !known.includes(rowType)
        : rowType === t;

    const hay = `${r.title} ${r.source} ${r.doi} ${r.year} ${r.typeLabel}`.toLowerCase();
    const matchesQuery = q ? hay.includes(q) : true;
    return matchesType && matchesQuery;
  });

  render(sortRows(filtered));
}


async function fetchAllOpenAlexWorks() {
  const cacheKey = `oa_works_${PUB_ORCID}`;
  // If offline or OpenAlex blocked, try cache
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    try { const c = JSON.parse(localStorage.getItem(cacheKey) || "null"); if (c?.items?.length) return c.items; } catch(_){}
  }

  // Primary source for publications (more complete than PUB_ORCID in many profiles)
  const items = [];
  let cursor = "*";
  // OpenAlex stores PUB_ORCID as a full URL: https://orcid.org/0000-0000-0000-0000
  const orcidUrl = `https://orcid.org/${PUB_ORCID}`;
  const base = `https://api.openalex.org/works?filter=authorships.author.orcid:${encodeURIComponent(orcidUrl)}&per-page=200&cursor=`;
  while (cursor) {
    const url = base + encodeURIComponent(cursor);
    const data = await fetchJson(url, { "Accept": "application/json" });
    const results = data?.results || [];
    for (const w of results) items.push(w);
    cursor = data?.meta?.next_cursor || null;
    // Safety stop (prevents accidental infinite loop)
    if (items.length > 2000) break;
  }
  try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), items })); } catch(_){ }
  return items;
}

function normalizeOAType(t){
  if (!t) return "other";
  const s = String(t).toLowerCase();
  // OpenAlex sometimes returns "posted-content" for preprints.
  if (s.includes("posted") || s === "posted-content") return "preprint";
  // Some sources may still provide ORCID-like labels.
  if (s.includes("journal-article") || (s.includes("journal") && s.includes("article"))) return "article";
  if (s.includes("conference") || s.includes("proceedings")) return "proceedings-article";
  if (s.includes("book-chapter")) return "book-chapter";
  if (s.includes("dissertation") || s.includes("thesis")) return "dissertation";
  if (s.includes("review")) return "review";
  if (s.includes("book")) return "book";
  if (s.includes("preprint")) return "preprint";
  // keep known OpenAlex types (article, review, preprint, etc.)
  return s;
}

function openalexTypeLabel(t) {
  // OpenAlex work types: "article", "book-chapter", "preprint", etc.
  if (!t) return "Other";
  const map = {
    article: "Article",
    review: "Review",
    preprint: "Preprint",
    book: "Book",
    "book-chapter": "Book chapter",
    "proceedings-article": "Conference paper",
    "posted-content": "Preprint",
    dissertation: "Thesis",
    dataset: "Dataset"
  };
  const key = String(t).toLowerCase();
  return map[key] || key.replaceAll("-", " ");
}

function normalizeFromOpenAlex(w) {
  const doi = w?.doi ? doiFromUrl(w.doi) : null;
  const year = w?.publication_year || null;
  const title = w?.title || "";
  const source = w?.host_venue?.display_name || "";
  const url = w?.primary_location?.landing_page_url || (doi ? `https://doi.org/${doi}` : "");
    const type = normalizeOAType(w?.type);
  const typeLabel = openalexTypeLabel(type);
  // OpenAlex per-work citations
  // Ensure it's always a number so sorting works reliably.
  const citations = Number.isFinite(Number(w?.cited_by_count)) ? Number(w.cited_by_count) : 0;

    return { title, source, year, doi, url, citations, type: type || "other", typeLabel };
}

async function loadPublications() {
  try {
    // Load PUB_ORCID from profile.json
    const profile = await loadProfile();

if (profile?.__error === "file_protocol") {
  pubBody.innerHTML = `<tr><td colspan="6" class="muted">Publications cannot load when opened via <code>file://</code>. Please run a local server (e.g., VSCode Live Server) and open the site via <code>http://localhost</code>.</td></tr>`;
  return;
}
if (profile?.__error === "fetch_failed") {
  pubBody.innerHTML = `<tr><td colspan="6" class="muted">Could not load <code>data/profile.json</code>. Please run a local server and check the browser console.</td></tr>`;
  return;
}

PUB_ORCID = String(profile?.orcid || PUB_ORCID || "").replaceAll("https://orcid.org/", "").trim();
if (!PUB_ORCID) {
  pubBody.innerHTML = `<tr><td colspan="6" class="muted">Please set your PUB_ORCID in <code>data/profile.json</code>.</td></tr>`;
  return;
}

    pubBody.innerHTML = `<tr><td colspan="6" class="muted">Fetching publications…</td></tr>`;

    // Local additions/overrides (small file you can maintain)
    const pubFixes = await loadPublicationOverrides();

    // Cache (24h) to keep the site fast + resilient
    const cacheKey = `ny_pubs_${PUB_ORCID}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      const ageH = (Date.now() - parsed.ts) / 36e5;
      // If we changed the schema (e.g., added per-paper citations),
      // ignore older cached copies that don't contain the new fields.
      const hasCitationsField = Array.isArray(parsed.items) && parsed.items.every(it => typeof it?.citations === "number");
      if (ageH < 24 && Array.isArray(parsed.items) && hasCitationsField) {
        // IMPORTANT: still apply the latest overrides + additions,
        // otherwise a cached copy can keep old misclassifications forever.
        let cachedRows = Array.isArray(parsed.items) ? parsed.items : [];
        cachedRows = applyPublicationOverrides(cachedRows, pubFixes.overrides);
        for (const add of (pubFixes.additions || [])) upsertAddition(cachedRows, add);

        // Keep sorting consistent
        cachedRows.sort((a, b) => (Number(b.year || 0) - Number(a.year || 0)) || String(a.title).localeCompare(String(b.title)));

        allRows = cachedRows;
        localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), items: allRows }));
        applyFilters();
        return;
      }
    }

    let rows = [];

    // 1) OpenAlex (preferred)
    try {
      const oaWorks = await fetchAllOpenAlexWorks();
      rows = oaWorks.map(normalizeFromOpenAlex);
    } catch (e) {
      // If OpenAlex is blocked on the user's network, fall back to PUB_ORCID
      rows = [];
    }

    // 2) If OpenAlex returned nothing (or failed), fallback to PUB_ORCID
    if (!rows.length) {
      const works = await fetchJson(`https://pub.orcid.org/v3.0/${PUB_ORCID}/works`, { "Accept": "application/json" });
      const groups = works?.group || [];
      const summaries = [];

      for (const g of groups) {
        const list = g?.["work-summary"] || [];
        const ws = pickBestSummary(list);
        if (!ws) continue;

        const title = ws?.title?.title?.value || "";
        const year = ws?.["publication-date"]?.year?.value || null;
        const type = normalizeType(ws?.type);

        const extIds = ws?.["external-ids"]?.["external-id"] || [];
        let doi = null;
        for (const e of extIds) {
          if (String(e?.["external-id-type"]).toLowerCase() === "doi") {
            doi = e?.["external-id-value"] || null;
            break;
          }
        }

        let url = "";
        if (doi) url = `https://doi.org/${doi}`;
        else if (ws?.url?.value) url = ws.url.value;

        summaries.push({ title, source: "", year, doi, url, type, typeLabel: typeLabel(type) });
      }
      rows = summaries;
    }

    // Enrich missing venue/year via Crossref (only when DOI exists and data is missing)
    let enriched = [];
    for (const r of rows) {
      if (r.doi && (!r.source || !r.year)) {
        try {
          const meta = await crossrefMeta(r.doi);
          enriched.push({ ...r, ...meta, typeLabel: r.typeLabel || typeLabel(r.type) });
          continue;
        } catch (_) { /* ignore */ }
      }
      enriched.push(r);
    }

    // Apply local overrides + inject additions (e.g., thesis from PRISMA)
    enriched = applyPublicationOverrides(enriched, pubFixes.overrides);
    for (const add of (pubFixes.additions || [])) upsertAddition(enriched, add);

    // Sort: newest first
    enriched.sort((a, b) => (Number(b.year || 0) - Number(a.year || 0)) || String(a.title).localeCompare(String(b.title)));

    allRows = enriched;
    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), items: allRows }));
    applyFilters();
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    pubBody.innerHTML = `<tr><td colspan="6" class="muted">Could not load publications. <span class="muted">(${escapeHtml(msg)})</span></td></tr>`;
  }
}


function pickBestSummary(list) {
  // Prefer: has DOI, then has year, then newest year
  let best = null;

  for (const ws of list) {
    const year = Number(ws?.["publication-date"]?.year?.value || 0);
    const extIds = ws?.["external-ids"]?.["external-id"] || [];
    const hasDoi = extIds.some(e => String(e?.["external-id-type"]).toLowerCase() === "doi" && e?.["external-id-value"]);
    const score = (hasDoi ? 1000 : 0) + (year ? year : 0);

    if (!best || score > best.score) best = { ws, score };
  }
  return best?.ws || list[0] || null;
}

// Wire up filters (safe even if the table hasn't loaded yet)
if (searchInput) searchInput.addEventListener("input", applyFilters);
if (typeSelect) typeSelect.addEventListener("change", applyFilters);
if (sortYearBtn) sortYearBtn.addEventListener("click", () => setSort("year"));
if (sortCitationsBtn) sortCitationsBtn.addEventListener("click", () => setSort("citations"));

loadPublications();
