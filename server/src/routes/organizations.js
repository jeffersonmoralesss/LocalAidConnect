// Organizations API route
// Implements REQ-3.2.1 (radius search), REQ-3.2.2 (sort by distance),
// REQ-3.2.3 (category filter), REQ-3.2.4 (open now filter),
// REQ-3.3.1/3.3.2 (organization detail with hours)

const { DEFAULT_RADIUS_MILES } = require("../constants");

/**
 * Calculate distance in miles between two lat/lng points using Haversine formula
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth's radius in miles
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Parse time string (HH:MM or HH:MM:SS) to minutes since midnight
 * Best-effort parsing for REQ-3.2.4
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours * 60 + minutes;
}

/**
 * Check if an organization is currently open (best-effort, REQ-3.2.4)
 * Returns true if open, false if closed, null if unknown (no hours data for today)
 */
function isOpenNow(db, organizationId, tzOffsetMinutes = null) {
  let now = new Date();
  let useUTC = false;

  if (tzOffsetMinutes !== null) {
    const utcTimeMs = now.getTime();
    const targetOffsetMs = tzOffsetMinutes * 60000;
    const targetTimeMs = utcTimeMs + targetOffsetMs;
    now = new Date(targetTimeMs);
    useUTC = true;
  }

  const currentDayOfWeek = useUTC ? now.getUTCDay() : now.getDay();
  const currentHours = useUTC ? now.getUTCHours() : now.getHours();
  const currentMins = useUTC ? now.getUTCMinutes() : now.getMinutes();
  const currentTimeStr = `${currentHours.toString().padStart(2, "0")}:${currentMins.toString().padStart(2, "0")}`;
  const currentMinutes = parseTimeToMinutes(currentTimeStr);

  const hours = db
    .prepare(
      `SELECT open_time, close_time, closed_indicator
       FROM hours
       WHERE organization_id = ? AND day_of_week = ?`
    )
    .all(organizationId, currentDayOfWeek);

  if (hours.length === 0) return null;

  for (const entry of hours) {
    if (entry.closed_indicator === 1) continue;

    const openMinutes = parseTimeToMinutes(entry.open_time);
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

// ─── Shared camelCase mappers ────────────────────────────────────────────────

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
    dayOfWeek: h.day_of_week,    // 0=Sun … 6=Sat
    openTime: h.open_time,        // "HH:MM" or null
    closeTime: h.close_time,      // "HH:MM" or null
    closedIndicator: h.closed_indicator === 1,
  };
}

// ─── GET /api/organizations ──────────────────────────────────────────────────

/**
 * GET /api/organizations
 * Query params: lat, lng, radiusMiles, category, openNow, tzOffsetMinutes
 * REQ-3.2.1–3.2.4
 */
function getOrganizations(req, res) {
  const db = req.app.locals.db;

  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radiusMiles =
    req.query.radiusMiles !== undefined
      ? parseFloat(req.query.radiusMiles)
      : DEFAULT_RADIUS_MILES;
  const category = req.query.category;
  const openNow = req.query.openNow === "true";
  const tzOffsetMinutes =
    req.query.tzOffsetMinutes !== undefined
      ? parseFloat(req.query.tzOffsetMinutes)
      : null;

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({
      error: "lat and lng query parameters are required and must be valid numbers",
    });
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({
      error: "lat must be between -90 and 90, lng must be between -180 and 180",
    });
  }

  if (radiusMiles <= 0) {
    return res.status(400).json({ error: "radiusMiles must be a positive number" });
  }

  if (tzOffsetMinutes !== null && isNaN(tzOffsetMinutes)) {
    return res.status(400).json({
      error: "tzOffsetMinutes must be a valid number if provided",
    });
  }

  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos(toRadians(lat)));

  let query, params;

  if (category) {
    query = `
      SELECT DISTINCT
        o.id, o.name, o.address, o.latitude, o.longitude,
        o.phone, o.website, o.verification_status, o.last_verified_at
      FROM organizations o
      INNER JOIN services s ON o.id = s.organization_id
      WHERE o.latitude BETWEEN ? AND ?
        AND o.longitude BETWEEN ? AND ?
        AND s.service_type = ?
    `;
    params = [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, category];
  } else {
    query = `
      SELECT id, name, address, latitude, longitude,
             phone, website, verification_status, last_verified_at
      FROM organizations
      WHERE latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
    `;
    params = [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta];
  }

  const candidates = db.prepare(query).all(...params);

  let results = candidates
    .map((org) => ({
      ...org,
      distanceMiles: Math.round(calculateDistance(lat, lng, org.latitude, org.longitude) * 100) / 100,
    }))
    .filter((org) => org.distanceMiles <= radiusMiles);

  results = results.map((org) => ({
    ...org,
    openNowStatus: isOpenNow(db, org.id, tzOffsetMinutes),
  }));

  if (openNow) {
    results = results.filter((org) => org.openNowStatus === true);
  }

  results.sort((a, b) => a.distanceMiles - b.distanceMiles);

  // Batch-fetch services
  const orgIds = results.map((o) => o.id);
  const servicesByOrgId = new Map();

  if (orgIds.length > 0) {
    const placeholders = orgIds.map(() => "?").join(",");
    const services = db
      .prepare(
        `SELECT id, organization_id, service_type, eligibility_description,
                cost_indicator, walk_in_indicator, id_requirement_indicator
         FROM services WHERE organization_id IN (${placeholders})`
      )
      .all(...orgIds);

    for (const s of services) {
      if (!servicesByOrgId.has(s.organization_id)) servicesByOrgId.set(s.organization_id, []);
      servicesByOrgId.get(s.organization_id).push(mapService(s));
    }
  }

  results = results.map((org) => ({
    ...org,
    services: servicesByOrgId.get(org.id) || [],
  }));

  res.json({ results });
}

// ─── GET /api/organizations/:id ──────────────────────────────────────────────

/**
 * GET /api/organizations/:id
 * Returns a single organization with its full services + hours schedule.
 * Used by the detail view (REQ-3.3.1, REQ-3.3.2).
 */
function getOrganizationById(req, res) {
  const db = req.app.locals.db;
  const orgId = parseInt(req.params.id, 10);

  if (isNaN(orgId) || orgId <= 0) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }

  const org = db
    .prepare(
      `SELECT id, name, address, latitude, longitude,
              phone, website, verification_status, last_verified_at
       FROM organizations WHERE id = ?`
    )
    .get(orgId);

  if (!org) {
    return res.status(404).json({ error: "Organization not found" });
  }

  const services = db
    .prepare(
      `SELECT id, service_type, eligibility_description,
              cost_indicator, walk_in_indicator, id_requirement_indicator
       FROM services WHERE organization_id = ? ORDER BY id`
    )
    .all(orgId)
    .map(mapService);

  // All 7 days, ordered Sun→Sat
  const hours = db
    .prepare(
      `SELECT id, day_of_week, open_time, close_time, closed_indicator
       FROM hours WHERE organization_id = ? ORDER BY day_of_week`
    )
    .all(orgId)
    .map(mapHour);

  res.json({ ...org, services, hours });
}

module.exports = { getOrganizations, getOrganizationById };
