// Organizations API route
// REQ-3.2.1 (radius search), REQ-3.2.2 (sort by distance),
// REQ-3.2.3 (category filter), REQ-3.2.4 (open now filter),
// REQ-3.3.1/3.3.2 (organization detail with hours).
//
// Also exposes admin endpoints for verification workflow:
//   - list unverified
//   - verify / unverify
// (Extension of REQ-3.5.2 — admin data quality maintenance.)

const { DEFAULT_RADIUS_MILES } = require("../constants");

// ─── Geometry helpers ─────────────────────────────────────────────────────
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

// ─── Open-now logic ───────────────────────────────────────────────────────
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function isOpenNow(db, organizationId, tzOffsetMinutes = null) {
  let now = new Date();
  let useUTC = false;

  if (tzOffsetMinutes !== null) {
    const utcTimeMs = now.getTime();
    const targetTimeMs = utcTimeMs + (tzOffsetMinutes * 60000);
    now = new Date(targetTimeMs);
    useUTC = true;
  }

  const currentDayOfWeek = useUTC ? now.getUTCDay() : now.getDay();
  const currentHours     = useUTC ? now.getUTCHours() : now.getHours();
  const currentMins      = useUTC ? now.getUTCMinutes() : now.getMinutes();
  const currentMinutes   = currentHours * 60 + currentMins;

  const hours = db.prepare(
    `SELECT open_time, close_time, closed_indicator
     FROM hours WHERE organization_id = ? AND day_of_week = ?`
  ).all(organizationId, currentDayOfWeek);

  if (hours.length === 0) return null;

  for (const entry of hours) {
    if (entry.closed_indicator === 1) continue;
    const openMinutes  = parseTimeToMinutes(entry.open_time);
    const closeMinutes = parseTimeToMinutes(entry.close_time);
    if (openMinutes === null || closeMinutes === null) continue;

    if (closeMinutes < openMinutes) {
      if (currentMinutes >= openMinutes || currentMinutes <= closeMinutes) return true;
    } else {
      if (currentMinutes >= openMinutes && currentMinutes <= closeMinutes) return true;
    }
  }
  return false;
}

// ─── Camel-case mappers ───────────────────────────────────────────────────
function mapService(s) {
  return {
    id: s.id,
    serviceType: s.service_type,
    eligibilityDescription: s.eligibility_description,
    costIndicator: s.cost_indicator,
    walkInIndicator: s.walk_in_indicator === 1,
    idRequirementIndicator: s.id_requirement_indicator === 1,
  };
}

function mapHour(h) {
  return {
    id: h.id,
    dayOfWeek: h.day_of_week,
    openTime: h.open_time,
    closeTime: h.close_time,
    closedIndicator: h.closed_indicator === 1,
  };
}

// Shape that list and detail endpoints both return.
// Note: last_verified_at can now be null (Option 2 — unverified imports).
function shapeOrgRow(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    phone: row.phone,
    website: row.website,
    verification_status: row.verification_status,
    last_verified_at: row.last_verified_at, // may be null
    data_source: row.data_source,           // 'LOCAL' | 'OSM'
    source_id: row.source_id,
    source_url: row.source_url,
  };
}

// ─── Core search (used by both GET /api/organizations and POST /api/search)
function searchOrganizations(db, { lat, lng, radiusMiles, category, openNow, tzOffsetMinutes }) {
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos(toRadians(lat)));

  let rows;
  if (category) {
    rows = db.prepare(`
      SELECT DISTINCT
        o.id, o.name, o.address, o.latitude, o.longitude,
        o.phone, o.website, o.verification_status, o.last_verified_at,
        o.data_source, o.source_id, o.source_url
      FROM organizations o
      INNER JOIN services s ON o.id = s.organization_id
      WHERE o.latitude BETWEEN ? AND ?
        AND o.longitude BETWEEN ? AND ?
        AND s.service_type = ?
    `).all(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, category);
  } else {
    rows = db.prepare(`
      SELECT id, name, address, latitude, longitude, phone, website,
             verification_status, last_verified_at,
             data_source, source_id, source_url
      FROM organizations
      WHERE latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
    `).all(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta);
  }

  let results = rows
    .map((org) => ({
      ...shapeOrgRow(org),
      distanceMiles: Math.round(calculateDistance(lat, lng, org.latitude, org.longitude) * 100) / 100,
    }))
    .filter((o) => o.distanceMiles <= radiusMiles);

  results = results.map((o) => ({
    ...o,
    openNowStatus: isOpenNow(db, o.id, tzOffsetMinutes),
  }));

  if (openNow) results = results.filter((o) => o.openNowStatus === true);

  results.sort((a, b) => a.distanceMiles - b.distanceMiles);

  // Batch-fetch services for displayed orgs.
  const orgIds = results.map((o) => o.id);
  const servicesByOrgId = new Map();
  if (orgIds.length > 0) {
    const placeholders = orgIds.map(() => "?").join(",");
    const svcs = db.prepare(`
      SELECT id, organization_id, service_type, eligibility_description,
             cost_indicator, walk_in_indicator, id_requirement_indicator
      FROM services WHERE organization_id IN (${placeholders})
    `).all(...orgIds);
    for (const s of svcs) {
      if (!servicesByOrgId.has(s.organization_id)) servicesByOrgId.set(s.organization_id, []);
      servicesByOrgId.get(s.organization_id).push(mapService(s));
    }
  }

  return results.map((o) => ({ ...o, services: servicesByOrgId.get(o.id) || [] }));
}

// ─── GET /api/organizations ───────────────────────────────────────────────
function getOrganizations(req, res) {
  const db = req.app.locals.db;
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radiusMiles = req.query.radiusMiles !== undefined
    ? parseFloat(req.query.radiusMiles) : DEFAULT_RADIUS_MILES;
  const category = req.query.category;
  const openNow  = req.query.openNow === "true";
  const tzOffsetMinutes = req.query.tzOffsetMinutes !== undefined
    ? parseFloat(req.query.tzOffsetMinutes) : null;

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: "lat and lng query parameters are required and must be valid numbers" });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "lat must be between -90 and 90, lng must be between -180 and 180" });
  }
  if (radiusMiles <= 0) {
    return res.status(400).json({ error: "radiusMiles must be a positive number" });
  }
  if (tzOffsetMinutes !== null && isNaN(tzOffsetMinutes)) {
    return res.status(400).json({ error: "tzOffsetMinutes must be a valid number if provided" });
  }

  const results = searchOrganizations(db, { lat, lng, radiusMiles, category, openNow, tzOffsetMinutes });
  res.json({ results });
}

// ─── GET /api/organizations/:id ───────────────────────────────────────────
function getOrganizationById(req, res) {
  const db = req.app.locals.db;
  const orgId = parseInt(req.params.id, 10);

  if (isNaN(orgId) || orgId <= 0) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }

  const row = db.prepare(`
    SELECT id, name, address, latitude, longitude,
           phone, website, verification_status, last_verified_at,
           data_source, source_id, source_url
    FROM organizations WHERE id = ?
  `).get(orgId);

  if (!row) return res.status(404).json({ error: "Organization not found" });

  const services = db.prepare(`
    SELECT id, service_type, eligibility_description, cost_indicator,
           walk_in_indicator, id_requirement_indicator
    FROM services WHERE organization_id = ? ORDER BY id
  `).all(orgId).map(mapService);

  const hours = db.prepare(`
    SELECT id, day_of_week, open_time, close_time, closed_indicator
    FROM hours WHERE organization_id = ? ORDER BY day_of_week
  `).all(orgId).map(mapHour);

  res.json({ ...shapeOrgRow(row), services, hours });
}

// ─── Admin: list UNVERIFIED orgs ──────────────────────────────────────────
// GET /api/admin/organizations?verification_status=UNVERIFIED
// TODO: protect with token-based auth before production.
function listOrganizations(req, res) {
  const db = req.app.locals.db;
  const vs = req.query.verification_status;

  if (vs !== undefined && !["VERIFIED", "UNVERIFIED", "PENDING"].includes(vs)) {
    return res.status(400).json({
      error: "verification_status must be one of: VERIFIED, UNVERIFIED, PENDING",
    });
  }

  const params = [];
  let where = "";
  if (vs) {
    where = "WHERE verification_status = ?";
    params.push(vs);
  }

  const rows = db.prepare(`
    SELECT id, name, address, latitude, longitude, phone, website,
           verification_status, last_verified_at,
           data_source, source_id, source_url,
           imported_at, last_seen_at
    FROM organizations
    ${where}
    ORDER BY imported_at DESC NULLS LAST, id DESC
  `).all(...params);

  res.json({
    results: rows.map((r) => ({
      ...shapeOrgRow(r),
      imported_at: r.imported_at,
      last_seen_at: r.last_seen_at,
    })),
  });
}

// ─── Admin: verify an org ─────────────────────────────────────────────────
// PATCH /api/admin/organizations/:id/verify
// TODO: protect with token-based auth before production.
function verifyOrganization(req, res) {
  const db = req.app.locals.db;
  const orgId = parseInt(req.params.id, 10);
  if (isNaN(orgId) || orgId <= 0) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }

  const exists = db.prepare("SELECT id FROM organizations WHERE id = ?").get(orgId);
  if (!exists) return res.status(404).json({ error: "Organization not found" });

  const ts = new Date().toISOString();
  db.prepare(`
    UPDATE organizations
    SET verification_status = 'VERIFIED',
        last_verified_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(ts, ts, orgId);

  const updated = db.prepare(`
    SELECT id, name, verification_status, last_verified_at, data_source
    FROM organizations WHERE id = ?
  `).get(orgId);

  res.json(updated);
}

// ─── Admin: unverify an org ───────────────────────────────────────────────
// PATCH /api/admin/organizations/:id/unverify
// Resets to UNVERIFIED and clears last_verified_at. Useful for mistakes or
// when a report invalidates a previously-verified listing.
// TODO: protect with token-based auth before production.
function unverifyOrganization(req, res) {
  const db = req.app.locals.db;
  const orgId = parseInt(req.params.id, 10);
  if (isNaN(orgId) || orgId <= 0) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }

  const exists = db.prepare("SELECT id FROM organizations WHERE id = ?").get(orgId);
  if (!exists) return res.status(404).json({ error: "Organization not found" });

  const ts = new Date().toISOString();
  db.prepare(`
    UPDATE organizations
    SET verification_status = 'UNVERIFIED',
        last_verified_at = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(ts, orgId);

  const updated = db.prepare(`
    SELECT id, name, verification_status, last_verified_at, data_source
    FROM organizations WHERE id = ?
  `).get(orgId);

  res.json(updated);
}

module.exports = {
  getOrganizations,
  getOrganizationById,
  searchOrganizations,   // exported for use by /api/search
  listOrganizations,
  verifyOrganization,
  unverifyOrganization,
};
