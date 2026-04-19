// server/src/routes/search.js
//
// POST /api/search
// Unified: takes natural-language text + coords, returns matching organizations.
// When local DB matches are thin, triggers an on-demand OSM import and re-runs
// the DB search so fresh candidates can appear in the same response.
//
// REQ-3.1 (AI parse) + REQ-3.2 (radius / category / open-now search).

const { DEFAULT_RADIUS_MILES } = require("../constants");
const { searchOrganizations } = require("./organizations");
const { parseTextToQuery } = require("./ai-parse");
const { fetchCandidates } = require("../providers/overpass");
const { importCandidates } = require("../services/import-candidates");

const IMPORT_THRESHOLD = 5; // below this, trigger OSM import

async function postSearch(req, res) {
  const db = req.app.locals.db;
  const { text, lat, lng, tzOffsetMinutes } = req.body || {};

  // ── Validate inputs ───────────────────────────────────────────────
  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "text is required and must be a non-empty string" });
  }
  if (typeof lat !== "number" || typeof lng !== "number" || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: "lat and lng are required numbers" });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "lat must be [-90, 90], lng must be [-180, 180]" });
  }
  const tz = typeof tzOffsetMinutes === "number" ? tzOffsetMinutes : null;

  // ── Step 1: parse text → structured query (REQ-3.1) ──────────────
  let parsed;
  try {
    parsed = await parseTextToQuery(text.trim());
  } catch (e) {
    // parseTextToQuery already has fallback; if this errors anyway, fail gracefully.
    return res.status(500).json({ error: `Query parse failed: ${e.message}` });
  }

  const query = parsed.query;
  const category = query.category && query.category !== "other" ? query.category : null;
  const radiusMiles = query.radiusMiles ?? DEFAULT_RADIUS_MILES;
  const openNow = !!(query.filters && query.filters.openNow);

  // ── Step 2: local DB search (REQ-3.2) ────────────────────────────
  let results = searchOrganizations(db, {
    lat, lng, radiusMiles, category, openNow, tzOffsetMinutes: tz,
  });

  // ── Step 3: if thin, import from OSM and re-run ──────────────────
  let importSummary = null;
  if (results.length < IMPORT_THRESHOLD && category) {
    const candidates = await fetchCandidates({ lat, lng, category, radiusMiles });
    if (candidates.length > 0) {
      importSummary = importCandidates(db, candidates, category);
      // Re-run the search so newly imported (UNVERIFIED) rows appear.
      results = searchOrganizations(db, {
        lat, lng, radiusMiles, category, openNow, tzOffsetMinutes: tz,
      });
    }
  }

  res.json({
    source: parsed.source,       // "ai" | "keyword"
    parsedQuery: query,
    results: { results },        // wrapped shape preserved from existing clients
    importSummary,               // null if no import happened
  });
}

module.exports = { postSearch };
