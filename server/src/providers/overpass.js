// server/src/providers/overpass.js
//
// OpenStreetMap / Overpass API provider.
// Fetches candidate organizations for a given category + radius around a point.
//
// Data is returned in a canonical shape regardless of OSM element type
// (node/way/relation). Results are not imported here — the caller is
// responsible for upsert + verification gating.
//
// This is a best-effort enrichment source. Every call has:
//   - A short timeout (we never block the user search indefinitely).
//   - A bounded element limit.
//   - An in-memory TTL cache to avoid hammering Overpass.
//
// Overpass etiquette: https://wiki.openstreetmap.org/wiki/Overpass_API#Introduction
// Public endpoint is rate-limited; for production you'd self-host or pay.

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const FETCH_TIMEOUT_MS = 6_000;     // hard cap per request
const CACHE_TTL_MS = 6 * 60 * 60_000; // 6 hours
const MAX_ELEMENTS = 50;            // cap results
const USER_AGENT = "LocalAidConnect/0.1 (MVP; contact=admin@localaid.example)";

// ─── Category → Overpass tag query ─────────────────────────────────────────
// Each entry becomes a union of node/way/relation queries inside (around:…).
// Kept conservative to maximize precision; broadening recall is a future concern.
const CATEGORY_TAGS = {
  food: [
    '["social_facility"="food_bank"]',
    '["amenity"="social_facility"]["social_facility"="food_bank"]',
    '["amenity"="community_centre"]["community_centre:for"~"homeless|poor"]',
  ],
  shelter: [
    '["social_facility"="shelter"]',
    '["amenity"="shelter"]["shelter_type"~"homeless|emergency"]',
  ],
  medical: [
    '["amenity"="clinic"]',
    '["amenity"="doctors"]',
    '["healthcare"="clinic"]',
    '["healthcare"="centre"]',
  ],
  vaccines: [
    '["healthcare"="clinic"]["healthcare:speciality"~"vaccination|community_health"]',
    '["amenity"="clinic"]["healthcare:speciality"~"vaccination"]',
  ],
  mental_health: [
    '["healthcare"="psychotherapist"]',
    '["healthcare:speciality"="psychiatry"]',
    '["social_facility"="outreach"]["social_facility:for"="mental_health"]',
  ],
  legal: [
    '["office"="lawyer"]["lawyer"~"legal_aid"]',
    '["amenity"="social_facility"]["social_facility"="outreach"]["social_facility:for"~"legal"]',
  ],
  other: [
    '["amenity"="social_facility"]',
    '["amenity"="community_centre"]',
  ],
};

const VALID_CATEGORIES = Object.keys(CATEGORY_TAGS);

// ─── In-memory TTL cache ────────────────────────────────────────────────────
const cache = new Map(); // key -> { expiresAt, data }

function cacheKey(lat, lng, category, radiusMiles) {
  // Round coords to 2 decimals (~0.7 miles) so nearby searches hit the same key.
  const latR = lat.toFixed(2);
  const lngR = lng.toFixed(2);
  return `${latR}|${lngR}|${category}|${radiusMiles}`;
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function setCached(key, data) {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data });
}

// Exposed for tests / manual invalidation.
function clearCache() {
  cache.clear();
}

// ─── Overpass QL builder ────────────────────────────────────────────────────
function buildQuery(category, lat, lng, radiusMeters) {
  const selectors = CATEGORY_TAGS[category] ?? CATEGORY_TAGS.other;
  // Union over all selectors, for nodes + ways + relations.
  const parts = [];
  for (const sel of selectors) {
    parts.push(`  node${sel}(around:${radiusMeters},${lat},${lng});`);
    parts.push(`  way${sel}(around:${radiusMeters},${lat},${lng});`);
    parts.push(`  relation${sel}(around:${radiusMeters},${lat},${lng});`);
  }
  return `[out:json][timeout:20];
(
${parts.join("\n")}
);
out center tags ${MAX_ELEMENTS};`;
}

// ─── Normalization helpers ──────────────────────────────────────────────────

// Best-effort single-line address from OSM address tags.
function buildAddress(tags) {
  const parts = [];
  const housenumber = tags["addr:housenumber"];
  const street = tags["addr:street"];
  if (housenumber && street) parts.push(`${housenumber} ${street}`);
  else if (street)           parts.push(street);
  const city    = tags["addr:city"];
  const state   = tags["addr:state"];
  const postcode= tags["addr:postcode"];
  if (city)     parts.push(city);
  if (state)    parts.push(state);
  if (postcode) parts.push(postcode);
  return parts.length > 0 ? parts.join(", ") : null;
}

function extractLatLng(el) {
  // Nodes have lat/lon directly; ways/relations use the `center` field from `out center`.
  if (el.type === "node" && typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

function sourceIdOf(el) {
  return `${el.type}/${el.id}`;
}

function sourceUrlOf(el) {
  return `https://www.openstreetmap.org/${el.type}/${el.id}`;
}

function normalizePhone(raw) {
  if (!raw) return null;
  // Take the first entry if multiple are semicolon-separated; trim whitespace.
  return raw.split(";")[0].trim() || null;
}

function normalizeWebsite(raw) {
  if (!raw) return null;
  const first = raw.split(";")[0].trim();
  if (!first) return null;
  if (/^https?:\/\//i.test(first)) return first;
  return `https://${first}`;
}

/**
 * Normalize a raw Overpass element into a candidate shape.
 * Returns null for elements that are unusable (no name or no coords).
 */
function normalizeElement(el) {
  const tags = el.tags || {};
  const name = tags.name;
  if (!name) return null;

  const coords = extractLatLng(el);
  if (!coords) return null;

  return {
    name,
    address: buildAddress(tags),
    latitude: coords.lat,
    longitude: coords.lng,
    phone: normalizePhone(tags.phone || tags["contact:phone"]),
    website: normalizeWebsite(tags.website || tags["contact:website"]),
    openingHours: tags.opening_hours || null,
    sourceType: "OSM",
    sourceId: sourceIdOf(el),
    sourceUrl: sourceUrlOf(el),
    rawTags: tags,
  };
}

// ─── Fetch with timeout ────────────────────────────────────────────────────
async function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Fetch candidate organizations from OSM for the given category + radius.
 *
 * Returns an array of candidates (may be empty). Never throws — all errors are
 * caught, logged, and turned into an empty array so the caller can degrade
 * gracefully.
 *
 * @param {object} params
 * @param {number} params.lat
 * @param {number} params.lng
 * @param {string} params.category
 * @param {number} params.radiusMiles
 * @returns {Promise<Array>} candidates
 */
async function fetchCandidates({ lat, lng, category, radiusMiles }) {
  if (!VALID_CATEGORIES.includes(category)) {
    return [];
  }
  if (typeof lat !== "number" || typeof lng !== "number" || !isFinite(lat) || !isFinite(lng)) {
    return [];
  }
  if (typeof radiusMiles !== "number" || radiusMiles <= 0) {
    return [];
  }

  const key = cacheKey(lat, lng, category, radiusMiles);
  const cached = getCached(key);
  if (cached) return cached;

  const radiusMeters = Math.min(Math.round(radiusMiles * 1609.34), 25_000); // hard cap 25km
  const query = buildQuery(category, lat, lng, radiusMeters);

  try {
    const res = await fetchWithTimeout(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({ data: query }).toString(),
    });

    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[overpass] non-OK response: ${res.status}`);
      setCached(key, []); // cache the miss briefly to avoid re-hammering
      return [];
    }

    const json = await res.json();
    const elements = Array.isArray(json?.elements) ? json.elements : [];
    const candidates = [];
    const seenSourceIds = new Set();

    for (const el of elements) {
      const norm = normalizeElement(el);
      if (!norm) continue;
      if (seenSourceIds.has(norm.sourceId)) continue;
      seenSourceIds.add(norm.sourceId);
      candidates.push(norm);
      if (candidates.length >= MAX_ELEMENTS) break;
    }

    setCached(key, candidates);
    return candidates;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[overpass] fetch failed: ${err.message}`);
    // Don't cache failures — next call should retry.
    return [];
  }
}

module.exports = {
  fetchCandidates,
  clearCache,
  // Exposed for tests/internal use:
  _internal: { normalizeElement, buildQuery, cacheKey },
};
