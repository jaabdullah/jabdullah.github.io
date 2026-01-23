// Auto-updating metrics + citations-by-year chart
// Source: OpenAlex (no scraping). Optional overrides in /data/metrics_override.json

// Configure your IDs in /data/profile.json
let MET_ORCID = "";

// Loaded from data/profile.json and used across functions
let profile = null;
// Preferred "Since" range start. Can be overridden in data/profile.json.
let CHART_START_YEAR = 2020;

// Chart range toggle: "last7" | "since" | "all"
let CHART_RANGE = "last7";

let LAST_COUNTS = []; // legacy: whichever series is currently shown
let LAST_COUNTS_OA = []; // OpenAlex citations grouped by publication year
let LAST_COUNTS_GS = []; // Google Scholar citations received per year
let LAST_COUNTS_SCOPUS = []; // Scopus citations received per year (manual file)

// Which series is currently displayed: "openalex" | "scholar" | "scopus"
let CHART_SOURCE = "openalex";

let PROFILE = null;

const elCitations = document.getElementById("mCitations");
const elWorks = document.getElementById("mWorks");
const elH = document.getElementById("mH");
const elI10 = document.getElementById("mI10");
const elSourcesBody = document.getElementById("metricsSourcesBody");
const elSource = document.getElementById("metricsSource");

// Source cards (new)
const elOaC_card = document.getElementById("oaCitations");
const elOaWorks_card = document.getElementById("oaWorks");
const elOaH_card = document.getElementById("oaH");
const elOaI10_card = document.getElementById("oaI10");

// Research Profile highlights (auto-filled from OpenAlex)
const elPhWorks = document.getElementById("phWorks");
const elPhCitations = document.getElementById("phCitations");
const elPhH = document.getElementById("phH");
const elPhI10 = document.getElementById("phI10");

const elGsC_card = document.getElementById("gsCitationsTotal");
const elGsH_card = document.getElementById("gsH");
const elGsI10_card = document.getElementById("gsI10");

const elScC_card = document.getElementById("scCitationsTotal");
const elScH_card = document.getElementById("scH");
const elScI10_card = document.getElementById("scI10");
// Citation total badges (chart-specific)
const elBadgeWrapOA = document.getElementById("badge-openalex");
const elBadgeWrapGS = document.getElementById("badge-scholar");
const elBadgeWrapSC = document.getElementById("badge-scopus");

// Card buttons (optional)
const cardOA = document.getElementById("cardOA");
const cardGS = document.getElementById("cardGS");
const cardSC = document.getElementById("cardSC");

// Chart DOM
const elChartTitle = document.getElementById("citationsChartTitle");
const elChartMeta = document.getElementById("citationsChartMeta");
const chartEl = document.getElementById("citationsChart");
// Impact badge DOM (totals above the citations chart)
const elBadgeOA = document.getElementById("openalex-total-citations");
const elBadgeGS = document.getElementById("scholar-total-citations");
const elBadgeSC = document.getElementById("scopus-total-citations");

if (elChartTitle) {
  elChartTitle.textContent = "Citations (OpenAlex publication-year vs Google Scholar citation-year)";
}


const btnLast7 = document.getElementById("rangeLast7");
const btnSince = document.getElementById("rangeSince");
const btnAll = document.getElementById("rangeAll");

// Source toggles
const btnSrcOA = document.getElementById("srcOpenAlex");
const btnSrcGS = document.getElementById("srcScholar");
const btnSrcSc = document.getElementById("srcScopus");

const elSourceName = document.getElementById("citationsChartSource");
const elScLastUpdated = document.getElementById("scopusLastUpdated");
const elMetricsLastUpdated = document.getElementById("metricsLastUpdated");
const elLegendLabel = document.getElementById("legendLabel");
const legendEl = document.getElementById("chartLegend");

function setActive(btn) {
  for (const b of [btnLast7, btnSince, btnAll]) {
    if (!b) continue;
    b.classList.toggle("isActive", b === btn);
  }
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function computeHIndex(citedByCounts) {
  const counts = (citedByCounts || []).map(Number).filter(Number.isFinite).sort((a,b)=>b-a);
  let h = 0;
  for (let i = 0; i < counts.length; i++) {
    const rank = i + 1;
    if (counts[i] >= rank) h = rank;
    else break;
  }
  return h;
}

function computeI10Index(citedByCounts) {
  return (citedByCounts || []).map(Number).filter(Number.isFinite).filter(x => x >= 10).length;
}

// OpenAlex does not provide a fully consistent "citations received per year" series for authors.
// For a coherent, auto-updating chart we compute *citations by publication year* from the works list.
function computeCitationsByPublicationYear(works) {
  const map = new Map();
  for (const w of (works || [])) {
    const year = Number(w?.publication_year || (w?.publication_date ? String(w.publication_date).slice(0, 4) : NaN));
    if (!Number.isFinite(year)) continue;
    const cited = Number(w?.cited_by_count || 0);
    map.set(year, (map.get(year) || 0) + (Number.isFinite(cited) ? cited : 0));
  }
  return Array.from(map.entries()).map(([year, cited_by_count]) => ({ year, cited_by_count }));
}

async function fetchAllOpenAlexWorksByOrcid(orcid) {
  const items = [];
  let cursor = "*";
  const orcidUrl = `https://orcid.org/${orcid}`;
  const base = `https://api.openalex.org/works?filter=authorships.author.orcid:${encodeURIComponent(orcidUrl)}&per-page=200&cursor=`;
  while (cursor) {
    const url = base + encodeURIComponent(cursor);
    const data = await fetchJson(url);
    const results = data?.results || [];
    for (const w of results) items.push(w);
    cursor = data?.meta?.next_cursor || null;
    if (items.length > 2500) break;
  }
  return items;
}

function showError(msg, detail) {
  const extra = detail ? ` (${detail})` : "";
  if (elSource) elSource.textContent = msg + extra;
}

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

async function loadOverrides() {
  try {
    const r = await fetch(`data/metrics_override.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function loadGoogleScholarCitationsByYear() {
  // Optional local file with Google Scholar "citations received per year".
  // This keeps the site static while still allowing quick periodic updates.
  try {
    const r = await fetch(`data/google_scholar_citations.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || typeof data !== "object") return null;
    const lastUpdated = String(data.lastUpdated || data.last_updated || "").trim();

    // Accept multiple simple schemas so updating is always easy:
    // 1) { "lastUpdated": "YYYY-MM-DD", "years": {"2021": 33, ... } }
    // 2) { "lastUpdated": "YYYY-MM-DD", "citationsByYear": {"2021": 33, ... } }
    // 3) { "lastUpdated": "YYYY-MM-DD", "data": [{"year":2021,"citations":33}, ...] }
    let years = data.years || data.citationsByYear || {};

    // Allow the simplest possible format:
    // {"2021":33, "2022":65, ...}
    if (!years || (typeof years === "object" && Object.keys(years).length === 0)) {
      // If the JSON is a plain year->count map, treat it as the data.
      const looksLikePlainMap = Object.keys(data).some(k => /^\d{4}$/.test(k));
      if (looksLikePlainMap) years = data;
    }

    const arr = Object.entries(years || {})
      .map(([y, c]) => ({ year: Number(y), cited_by_count: Number(c) }))
      .filter(x => Number.isFinite(x.year) && Number.isFinite(x.cited_by_count))
      .sort((a, b) => a.year - b.year);

    // Alternative array form
    if (!arr.length && Array.isArray(data.data)) {
      const arr2 = data.data
        .map((row) => ({
          year: Number(row?.year),
          cited_by_count: Number(row?.citations ?? row?.cited_by_count ?? row?.count)
        }))
        .filter(x => Number.isFinite(x.year) && Number.isFinite(x.cited_by_count))
        .sort((a, b) => a.year - b.year);
      if (arr2.length) return { lastUpdated, series: arr2 };
    }
    return { lastUpdated, series: arr };
  } catch {
    return null;
  }
}

async function loadScopusCitationsByYear() {
  // Optional local file with Scopus "citations received per year".
  try {
    const r = await fetch(`data/scopus_citations.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json();
    if (!data || typeof data !== "object") return null;
    const lastUpdated = String(data.lastUpdated || data.last_updated || "").trim();

    // Accept schemas similar to Google Scholar file.
    let years = data.years || data.citationsByYear || data.scopusCitationsByYear || {};
    if (!years || (typeof years === "object" && Object.keys(years).length === 0)) {
      const looksLikePlainMap = Object.keys(data).some(k => /^\d{4}$/.test(k));
      if (looksLikePlainMap) years = data;
    }

    const arr = Object.entries(years || {})
      .map(([y, c]) => ({ year: Number(y), cited_by_count: Number(c) }))
      .filter(x => Number.isFinite(x.year) && Number.isFinite(x.cited_by_count))
      .sort((a, b) => a.year - b.year);

    if (!arr.length && Array.isArray(data.data)) {
      const arr2 = data.data
        .map((row) => ({
          year: Number(row?.year),
          cited_by_count: Number(row?.citations ?? row?.cited_by_count ?? row?.count)
        }))
        .filter(x => Number.isFinite(x.year) && Number.isFinite(x.cited_by_count))
        .sort((a, b) => a.year - b.year);
      if (arr2.length) return { lastUpdated, series: arr2 };
    }
    return { lastUpdated, series: arr };
  } catch {
    return null;
  }
}

function normalizeCountsByYear(countsByYear, overrides) {
  const map = new Map();
  for (const item of (countsByYear || [])) {
    if (!item?.year) continue;
    map.set(Number(item.year), Number(item.cited_by_count || 0));
  }

  // Apply overrides (e.g., align specific years with Google Scholar)
  const oy = overrides?.citationsByYearOverrides || {};
  for (const [y, v] of Object.entries(oy)) {
    const year = Number(y);
    if (!Number.isFinite(year)) continue;
    map.set(year, Number(v || 0));
  }

  if (map.size === 0) return [];

  // Only fill gaps *within* the observed year range.
  // We do NOT extend to the current year (that would create misleading 0 bars).
  const years = Array.from(map.keys()).sort((a, b) => a - b);
  const minObserved = years[0];
  const maxObserved = years[years.length - 1];
  const minY = Math.max(minObserved, Number(CHART_START_YEAR || minObserved));
  const maxY = maxObserved;

  const out = [];
  for (let y = minY; y <= maxY; y++) {
    out.push({ year: y, cited_by_count: map.get(y) ?? 0 });
  }
  return out;
}

function getCountsSlice(counts) {
  if (!counts?.length) return [];
  if (CHART_RANGE === "all") return counts;
  if (CHART_RANGE === "since") return counts.filter(x => Number(x.year) >= Number(CHART_START_YEAR || 2021));
  // last7
  const lastYear = Number(counts[counts.length - 1].year);
  const start = lastYear - 6;
  return counts.filter(x => Number(x.year) >= start);
}

function renderSingleSeriesChart(counts, opts = {}) {
  if (!chartEl) return;
  if (!counts?.length) {
    chartEl.innerHTML = `<div class="muted">Could not load citations by year.</div>`;
    return;
  }

  const slice = getCountsSlice(counts);
  const max = Math.max(...slice.map(x => x.cited_by_count), 1);
  const barClass = opts?.barClass || "bar__col";

  chartEl.innerHTML = slice.map(x => {
    const h = Math.max(2, Math.round((x.cited_by_count / max) * 140));
    return `
      <div class="bar" title="${x.year}: ${x.cited_by_count}">
        <div class="bar__val">${x.cited_by_count}</div>
        <div class="${barClass}" style="height:${h}px"></div>
        <div class="bar__year">${x.year}</div>
      </div>
    `;
  }).join("");
}

function renderDualChart(oaCounts, gsCounts) {
  if (!chartEl) return;

  const oa = Array.isArray(oaCounts) ? oaCounts : [];
  const gs = Array.isArray(gsCounts) ? gsCounts : [];

  if (!oa.length && !gs.length) {
    chartEl.innerHTML = `<div class="muted">Could not load citations by year.</div>`;
    return;
  }

  // Union of years across both series
  const byYear = new Map();
  for (const x of oa) byYear.set(String(x.year), { year: String(x.year), oa: Number(x.cited_by_count) || 0, gs: 0 });
  for (const x of gs) {
    const y = String(x.year);
    const row = byYear.get(y) || { year: y, oa: 0, gs: 0 };
    row.gs = Number(x.cited_by_count) || 0;
    byYear.set(y, row);
  }

  let merged = Array.from(byYear.values()).sort((a, b) => Number(a.year) - Number(b.year));

  // Apply range slicing based on the merged years.
  const yearsOnly = merged.map(x => ({ year: x.year, cited_by_count: Math.max(x.oa, x.gs) }));
  const sliceYears = new Set(getCountsSlice(yearsOnly).map(x => String(x.year)));
  merged = merged.filter(x => sliceYears.has(String(x.year)));

  const maxOA = Math.max(...merged.map(x => x.oa), 1);
  const maxGS = Math.max(...merged.map(x => x.gs), 1);

  chartEl.innerHTML = merged.map(x => {
    const hOA = x.oa ? Math.max(2, Math.round((x.oa / maxOA) * 140)) : 2;
    const hGS = x.gs ? Math.max(2, Math.round((x.gs / maxGS) * 140)) : 2;

    return `
      <div class="bar bar--dual" title="${x.year} · OpenAlex (publication year): ${x.oa} · Google Scholar (citation year): ${x.gs}">
        <div class="bar__val bar__val--split">
          <span class="val--oa">${x.oa || 0}</span>
          <span class="val--gs">${x.gs || 0}</span>
        </div>
        <div class="bar__pair">
          <div class="bar__col bar__col--oa" style="height:${hOA}px"></div>
          <div class="bar__col bar__col--gs" style="height:${hGS}px"></div>
        </div>
        <div class="bar__year">${x.year}</div>
      </div>
    `;
  }).join("");
}

function renderChart() {
  if (!chartEl) return;

  let series = [];
  let label = "";
  let swatch = "legendSwatch--oa";

  if (CHART_SOURCE === "scholar") {
    series = LAST_COUNTS_GS;
    label = "Google Scholar";
    swatch = "legendSwatch--gs";
  } else if (CHART_SOURCE === "scopus") {
    series = LAST_COUNTS_SCOPUS;
    label = "Scopus";
    swatch = "legendSwatch--sc";
  } else {
    series = LAST_COUNTS_OA;
    label = "OpenAlex";
    swatch = "legendSwatch--oa";
  }

  if (elSourceName) elSourceName.textContent = label;
  if (elLegendLabel) elLegendLabel.textContent = label;
  if (legendEl) {
    legendEl.innerHTML = `<div class="legendItem"><span class="legendSwatch ${swatch}" aria-hidden="true"></span><span id="legendLabel">${label}</span></div>`;
  }

  renderSingleSeriesChart(series, { barClass: `bar__col ${CHART_SOURCE === 'scholar' ? 'bar__col--gs' : CHART_SOURCE === 'scopus' ? 'bar__col--sc' : 'bar__col--oa'}` });
}

function setActiveSource(btn) {
  for (const b of [btnSrcOA, btnSrcGS, btnSrcSc]) {
    if (!b) continue;
    b.classList.toggle("isActive", b === btn);
  }
  setActiveMetricCard(CHART_SOURCE);
setActiveBadge(CHART_SOURCE);
}



function setActiveMetricCard(src){
  if (!cardOA || !cardGS || !cardSC) return;
  const map = { openalex: cardOA, scholar: cardGS, scopus: cardSC };
  for (const [k, el] of Object.entries(map)) {
    el.classList.toggle("isActive", k === src);
  }
}
function setActiveBadge(src) {
  const map = {
    openalex: elBadgeWrapOA,
    scholar: elBadgeWrapGS,
    scopus: elBadgeWrapSC
  };
  for (const [k, el] of Object.entries(map)) {
    if (!el) continue;
    el.classList.toggle("isActive", k === src);
  }
}

function wireMetricCards(){
  if (cardOA && btnSrcOA) cardOA.addEventListener("click", () => { btnSrcOA.click(); document.getElementById("citationsChart")?.scrollIntoView({behavior:"smooth", block:"start"}); });
  if (cardGS && btnSrcGS) cardGS.addEventListener("click", () => { btnSrcGS.click(); document.getElementById("citationsChart")?.scrollIntoView({behavior:"smooth", block:"start"}); });
  if (cardSC && btnSrcSc) cardSC.addEventListener("click", () => { btnSrcSc.click(); document.getElementById("citationsChart")?.scrollIntoView({behavior:"smooth", block:"start"}); });
}

function wireChartToggles() {
  if (btnLast7) {
    btnLast7.addEventListener("click", () => {
      CHART_RANGE = "last7";
      setActive(btnLast7);
      renderChart();
    });
  }
  if (btnSince) {
    btnSince.addEventListener("click", () => {
      CHART_RANGE = "since";
      setActive(btnSince);
      renderChart();
    });
  }
  if (btnAll) {
    btnAll.addEventListener("click", () => {
      CHART_RANGE = "all";
      setActive(btnAll);
      renderChart();
    });
  }

  // Source toggles
  if (btnSrcOA) {
    btnSrcOA.addEventListener("click", () => {
      CHART_SOURCE = "openalex";
      setActiveSource(btnSrcOA);
      renderChart();
    });
  }
  if (btnSrcGS) {
    btnSrcGS.addEventListener("click", () => {
      CHART_SOURCE = "scholar";
      setActiveSource(btnSrcGS);
      renderChart();
    });
  }
  if (btnSrcSc) {
    btnSrcSc.addEventListener("click", () => {
      CHART_SOURCE = "scopus";
      setActiveSource(btnSrcSc);
      renderChart();
    });
  }
}

async function resolveOpenAlexAuthorId() {
  // Prefer MET_ORCID filter (no guessing)
  // OpenAlex stores MET_ORCID as a full URL: https://orcid.org/0000-0000-0000-0000
  const orcidUrl = `https://orcid.org/${MET_ORCID}`;
  const data = await fetchJson(`https://api.openalex.org/authors?filter=orcid:${encodeURIComponent(orcidUrl)}`);
  const results = data?.results || [];
  if (!results.length) return null;

  // If multiple, pick the one with the highest works_count
  results.sort((a, b) => (b?.works_count || 0) - (a?.works_count || 0));
  return results[0]?.id || null;
}

function formatNumber(n) {
  try { return Number(n).toLocaleString(); } catch { return String(n); }
}

async function loadMetrics() {
  // Load MET_ORCID from profile.json (fallback to the embedded value if present)
  profile = await loadProfile();

if (profile?.__error === "file_protocol") {
  showError("Metrics unavailable: open this site via a local server (e.g., VSCode Live Server) — browsers block data loading from file://.");
  return;
}
if (profile?.__error === "fetch_failed") {
  showError("Metrics unavailable: could not load data/profile.json. Run via a local server and check the browser console.", profile.__detail);
  return;
}

MET_ORCID = String(profile?.orcid || MET_ORCID || "").replaceAll("https://orcid.org/", "").trim();
CHART_START_YEAR = Number(profile?.citationsChartStartYear || CHART_START_YEAR || 2020);

// Update the "Since" button label dynamically
try {
  if (btnSince) btnSince.textContent = `Since ${CHART_START_YEAR}`;
} catch { /* ignore */ }

// Optional manual citations-by-year series (updated periodically)
const gsByYear = await loadGoogleScholarCitationsByYear();
const scByYear = await loadScopusCitationsByYear();
try {
  const elGS = document.getElementById("gsLastUpdated");
  if (elGS && gsByYear?.lastUpdated) elGS.textContent = gsByYear.lastUpdated;
} catch { /* ignore */ }
try {
  if (elScLastUpdated && scByYear?.lastUpdated) elScLastUpdated.textContent = scByYear.lastUpdated;
} catch { /* ignore */ }
const scholar = profile?.googleScholar || {};
const scopus = profile?.scopus || {};
if (!MET_ORCID) {
  showError("Metrics unavailable (MET_ORCID missing in data/profile.json)." );
  return;
}

  const cacheKey = `ny_metrics_${MET_ORCID}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      const ageH = (Date.now() - parsed.ts) / 36e5;
      if (ageH < 12 && parsed?.payload) {
        // Even when using cached OpenAlex data, show the latest locally-configured
        // Google Scholar / Scopus public numbers from profile.json.
        applyMetrics(parsed.payload, true, { scholar, scopus, gsByYear, scByYear });
      }
    }
  } catch { /* ignore */ }

  try {
    const overrides = await loadOverrides();
    const authorId = (overrides?.openalexAuthorId) || await resolveOpenAlexAuthorId();
    if (!authorId) throw new Error("No OpenAlex author found for MET_ORCID");

    // OpenAlex returns an ID like https://openalex.org/A123... which is NOT fetchable via XHR due to CORS.
    // Convert it to the API URL.
    const authorApiId = String(authorId).replace("https://openalex.org/", "https://api.openalex.org/");
    const author = await fetchJson(authorApiId);

    // Compute OpenAlex-derived h-index + i10-index from works + build a consistent
    // "citations by year" series (grouped by publication year) so that the chart
    // sum matches the displayed OpenAlex citation total.
    let oaH = null;
    let oaI10 = null;
    let oaWorksCount = null;
    let oaCitationsSum = null;
    let oaCitationsByPubYear = [];
    try {
      const works = await fetchAllOpenAlexWorksByOrcid(MET_ORCID);
      const counts = works.map(w => Number(w?.cited_by_count || 0));
      oaH = computeHIndex(counts);
      oaI10 = computeI10Index(counts);

      oaWorksCount = works.length;
      oaCitationsSum = counts.reduce((a,b)=>a + (Number.isFinite(b) ? b : 0), 0);

      // Group citations by publication year (OpenAlex doesn't provide "citations received per year"
      // without additional datasets). This is still useful and internally consistent.
      const byYear = new Map();
      for (const w of works) {
        const y = Number(w?.publication_year || (w?.publication_date ? String(w.publication_date).slice(0,4) : NaN));
        if (!Number.isFinite(y)) continue;
        const c = Number(w?.cited_by_count || 0);
        byYear.set(y, (byYear.get(y) || 0) + (Number.isFinite(c) ? c : 0));
      }
      oaCitationsByPubYear = [...byYear.entries()].map(([year, cited_by_count])=>({year, cited_by_count}));
    } catch {
      // If works endpoint is blocked, keep OA h/i10 empty.
    }

    const payload = {
      author,
      overrides,
      // Prefer the work-derived aggregates (consistent with the chart), but keep the author object too.
      oaWorksCount,
      oaCitationsSum,
      oaCitationsByPubYear
    };
    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), payload }));
    applyMetrics(payload, false, { scholar, scopus, oaH, oaI10, gsByYear, scByYear });
  } catch (e) {
    // Fallback: if overrides exist, at least render those
    const overrides = await loadOverrides();
    if (overrides?.citationsByYearOverrides || overrides?.totalCitationsOverride || overrides?.worksOverride) {
      applyMetrics({ author: { cited_by_count: overrides?.totalCitationsOverride ?? "—", works_count: overrides?.worksOverride ?? "—", counts_by_year: [] }, overrides }, false, { scholar, scopus, oaH: null, oaI10: null, gsByYear, scByYear });
      showError("Updated from OpenAlex unavailable.");
      return;
    }
    showError("Metrics unavailable (cannot reach OpenAlex).", e && e.message ? e.message : String(e));
  }
}

function applyMetrics(payload, fromCache, sources) {
  const { author, overrides } = payload;

  // Use work-derived totals when available, because they are consistent with the chart.
  const cited = overrides?.totalCitationsOverride
    ?? payload?.oaCitationsSum
    ?? author?.cited_by_count
    ?? "—";

  const works = overrides?.worksOverride
    ?? payload?.oaWorksCount
    ?? author?.works_count
    ?? "—";

  if (elCitations) elCitations.textContent = cited === "—" ? "—" : formatNumber(cited);
  if (elWorks) elWorks.textContent = works === "—" ? "—" : formatNumber(works);

  // Source cards
  if (elOaC_card) elOaC_card.textContent = cited === "—" ? "—" : formatNumber(cited);
  if (elOaWorks_card) elOaWorks_card.textContent = works === "—" ? "—" : formatNumber(works);
  // Research Profile highlights (keep consistent with OpenAlex card)
  if (elPhCitations) elPhCitations.textContent = cited === "—" ? "—" : formatNumber(cited);
  if (elPhWorks) elPhWorks.textContent = works === "—" ? "—" : formatNumber(works);
  if (elPhH) elPhH.textContent = (sources?.oaH ?? "—");
  if (elPhI10) elPhI10.textContent = (sources?.oaI10 ?? "—");

  if (elOaH_card) elOaH_card.textContent = (sources?.oaH ?? "—");
  if (elOaI10_card) elOaI10_card.textContent = (sources?.oaI10 ?? "—");

  // Google Scholar manual totals (from profile.json)
  const gsTotals = profile?.googleScholar || {};
  if (elGsC_card) elGsC_card.textContent = (gsTotals.citations ?? "—") === "—" ? "—" : formatNumber(gsTotals.citations);
  if (elGsH_card) elGsH_card.textContent = (gsTotals.hIndex ?? "—");
  if (elGsI10_card) elGsI10_card.textContent = (gsTotals.i10Index ?? "—");

  // Scopus manual totals (from profile.json)
  const scTotals = profile?.scopus || {};
  if (elScC_card) elScC_card.textContent = (scTotals.citations ?? "—") === "—" ? "—" : formatNumber(scTotals.citations);
  if (elScH_card) elScH_card.textContent = (scTotals.hIndex ?? "—");
  if (elScI10_card) elScI10_card.textContent = (scTotals.i10Index ?? "—");
  // === Impact badges (totals shown above chart) ===
  // OpenAlex total: use "cited" (already computed and consistent with OA series)
  if (elBadgeOA) {
    elBadgeOA.textContent = cited === "—" ? "—" : formatNumber(cited);
  }

  // Google Scholar total: from profile.json (manual / updated file)
  if (elBadgeGS) {
    const v = gsTotals?.citations;
    elBadgeGS.textContent = (v == null) ? "—" : formatNumber(v);
  }

  // Scopus total: from profile.json (auto-updated by your script)
  if (elBadgeSC) {
    const v = scTotals?.citations;
    elBadgeSC.textContent = (v == null) ? "—" : formatNumber(v);
  }

  // Top cards: prefer Google Scholar values if provided; otherwise show OpenAlex-derived
  const gsH = sources?.scholar?.hIndex;
  const gsI10 = sources?.scholar?.i10Index;
  const oaH = sources?.oaH;
  const oaI10 = sources?.oaI10;

  if (elH) elH.textContent = (gsH ?? oaH ?? "—");
  if (elI10) elI10.textContent = (gsI10 ?? oaI10 ?? "—");

  // Build BOTH chart series when available.
  // - OpenAlex: citations grouped by *publication year* ("impact" of works published that year)
  // - Google Scholar: citations received in *citation year* (traditional "citations per year")
  const oaSeriesRaw = (payload?.oaCitationsByPubYear && payload.oaCitationsByPubYear.length)
    ? payload.oaCitationsByPubYear
    : (author?.counts_by_year || []);
  const gsSeriesRaw = (sources?.gsByYear?.series && sources.gsByYear.series.length)
    ? sources.gsByYear.series
    : [];
  const scSeriesRaw = (sources?.scByYear?.series && sources.scByYear.series.length)
    ? sources.scByYear.series
    : [];

  const oaCounts = normalizeCountsByYear(oaSeriesRaw, overrides);
  const gsCounts = normalizeCountsByYear(gsSeriesRaw, overrides);
  const scCounts = normalizeCountsByYear(scSeriesRaw, overrides);

  LAST_COUNTS_OA = oaCounts;
  LAST_COUNTS_GS = gsCounts;
  LAST_COUNTS_SCOPUS = scCounts;
  LAST_COUNTS = oaCounts.length ? oaCounts : (gsCounts.length ? gsCounts : scCounts); // legacy fallback

  if (elChartTitle) elChartTitle.textContent = "Citations per year";

  // Ensure the currently selected source has a valid series; fall back gracefully.
  if (CHART_SOURCE === "scholar" && !LAST_COUNTS_GS.length) CHART_SOURCE = "openalex";
  if (CHART_SOURCE === "scopus" && !LAST_COUNTS_SCOPUS.length) CHART_SOURCE = "openalex";

  renderChart();
setActiveBadge(CHART_SOURCE);


  const updated = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  if (elSource) elSource.textContent = `Updated ${updated}`;
  if (elMetricsLastUpdated) elMetricsLastUpdated.textContent = updated;


  // Sources table
  if (elSourcesBody) {
    const rows = [];
    rows.push({
      name: "OpenAlex",
      citations: cited === "—" ? "—" : formatNumber(cited),
      h: oaH ?? "—",
      i10: oaI10 ?? "—"
    });

    const gsC = sources?.scholar?.citations;
    const gsRowHasAny = (gsC != null) || (gsH != null) || (gsI10 != null);
    rows.push({
      name: "Google Scholar",
      citations: (gsC == null ? "—" : formatNumber(gsC)),
      h: (gsH ?? "—"),
      i10: (gsI10 ?? "—")
    });

    const scC = sources?.scopus?.citations;
    const scH = sources?.scopus?.hIndex;
    const scI10 = sources?.scopus?.i10Index;
    rows.push({
      name: "Scopus",
      citations: (scC == null ? "—" : formatNumber(scC)),
      h: (scH ?? "—"),
      i10: (scI10 ?? "—")
    });

    elSourcesBody.innerHTML = rows.map(r => `
      <tr>
        <td>${r.name}</td>
        <td>${r.citations}</td>
        <td>${r.h}</td>
        <td>${r.i10}</td>
      </tr>
    `).join("");
  }
}

wireChartToggles();
wireMetricCards();

loadMetrics();