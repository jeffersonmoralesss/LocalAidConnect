// Combined search endpoint: REQ-3.1 + REQ-3.2
// POST /api/search

const { parseTextToQuery } = require("./ai-parse");
const { searchOrganizations } = require("../services/search");

async function postSearch(req, res) {
  const db = req.app.locals.db;
  const { text, lat, lng, tzOffsetMinutes } = req.body || {};

  // Validate request body
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({
      error: "text is required and must be a non-empty string",
    });
  }

  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return res.status(400).json({
      error: "lat and lng are required and must be valid numbers",
    });
  }

  if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({
      error: "lat must be between -90 and 90, lng must be between -180 and 180",
    });
  }

  const tz =
    tzOffsetMinutes === undefined || tzOffsetMinutes === null
      ? null
      : Number(tzOffsetMinutes);

  if (tz !== null && !Number.isFinite(tz)) {
    return res.status(400).json({
      error: "tzOffsetMinutes must be a valid number if provided",
    });
  }

  try {
    // REQ-3.1: parse natural language into strict query (AI or keyword fallback)
    const { parsedQuery, source } = await parseTextToQuery(text);

    // REQ-3.2: run the org search using parsed parameters
    const resultsArray = searchOrganizations(db, {
      lat: latNum,
      lng: lngNum,
      radiusMiles: parsedQuery.radiusMiles,
      category: parsedQuery.category,
      openNow: Boolean(parsedQuery.filters?.openNow),
      tzOffsetMinutes: tz,
    });

    // IMPORTANT: results field matches GET /api/organizations shape
    return res.json({
      source,
      parsedQuery,
      results: { results: resultsArray },
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Search failed",
      details: err.details || undefined,
    });
  }
}

module.exports = { postSearch };
