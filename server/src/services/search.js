// Shared search logic for organizations (REQ-3.2.1–REQ-3.2.5)
// Used by GET /api/organizations and POST /api/search

const { DEFAULT_RADIUS_MILES } = require("../constants");

function toRadians(deg) {
  return deg * (Math.PI / 180);
}

function calculateDistanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3959; // miles
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours * 60 + minutes;
}

/**
 * Best-effort "open now" evaluation (REQ-3.2.4).
 * tzOffsetMinutes is offset FROM UTC (e.g., EST = -300).
 */
function isOpenNow(db, organizationId, tzOffsetMinutes = null) {
  let now = new Date();
  let useUTC = false;

  if (tzOffsetMinutes !== null) {
    // Shift the epoch by tzOffsetMinutes; then read components using UTC getters
    const targetMs = now.getTime() + tzOffsetMinutes * 60000;
    now = new Date(targetMs);
    useUTC = true;
  }

  const day = useUTC ? now.getUTCDay() : now.getDay();
  const hoursNow = useUTC ? now.getUTCHours() : now.getHours();
  const minsNow = useUTC ? now.getUTCMinutes() : now.getMinutes();
  const currentMinutes = hoursNow * 60 + minsNow;

  const todays = db
    .prepare(
      `
      SELECT open_time, close_time, closed_indicator
      FROM hours
      WHERE organization_id = ? AND day_of_week = ?
    `
    )
    .all(organizationId, day);

  if (todays.length === 0) return null;

  for (const entry of todays) {
    if (entry.closed_indicator === 1) continue;

    const openM = parseTimeToMinutes(entry.open_time);
    const closeM = parseTimeToMinutes(entry.close_time);
    if (openM === null || closeM === null) continue;

    // spans midnight
    if (closeM < openM) {
      if (currentMinutes >= openM || currentMinutes <= closeM) return true;
    } else {
      if (currentMinutes >= openM && currentMinutes <= closeM) return true;
    }
  }

  return false;
}

/**
 * Shared org search (REQ-3.2.1–REQ-3.2.5)
 */
function searchOrganizations(db, params) {
  const {
    lat,
    lng,
    radiusMiles = DEFAULT_RADIUS_MILES,
    category,
    openNow = false,
    tzOffsetMinutes = null,
  } = params;

  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos(toRadians(lat)));

  let query;
  let qparams;

  if (category) {
    query = `
      SELECT DISTINCT
        o.id,
        o.name,
        o.address,
        o.latitude,
        o.longitude,
        o.phone,
        o.website,
        o.verification_status,
        o.last_verified_at
      FROM organizations o
      INNER JOIN services s ON o.id = s.organization_id
      WHERE o.latitude BETWEEN ? AND ?
        AND o.longitude BETWEEN ? AND ?
        AND s.service_type = ?
    `;
    qparams = [
      lat - latDelta,
      lat + latDelta,
      lng - lngDelta,
      lng + lngDelta,
      category,
    ];
  } else {
    query = `
      SELECT
        id,
        name,
        address,
        latitude,
        longitude,
        phone,
        website,
        verification_status,
        last_verified_at
      FROM organizations
      WHERE latitude BETWEEN ? AND ?
        AND longitude BETWEEN ? AND ?
    `;
    qparams = [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta];
  }

  const candidates = db.prepare(query).all(...qparams);

  let results = candidates
    .map((org) => {
      const d = calculateDistanceMiles(lat, lng, org.latitude, org.longitude);
      return { ...org, distanceMiles: Math.round(d * 100) / 100 };
    })
    .filter((org) => org.distanceMiles <= radiusMiles);

  results = results.map((org) => ({
    ...org,
    openNowStatus: isOpenNow(db, org.id, tzOffsetMinutes),
  }));

  if (openNow) {
    results = results.filter((org) => org.openNowStatus === true);
  }

  results.sort((a, b) => a.distanceMiles - b.distanceMiles);

  const orgIds = results.map((r) => r.id);
  const servicesByOrgId = new Map();

  if (orgIds.length) {
    const placeholders = orgIds.map(() => "?").join(",");
    const services = db
      .prepare(
        `
        SELECT
          id,
          organization_id,
          service_type,
          eligibility_description,
          cost_indicator,
          walk_in_indicator,
          id_requirement_indicator
        FROM services
        WHERE organization_id IN (${placeholders})
      `
      )
      .all(...orgIds);

    for (const s of services) {
      if (!servicesByOrgId.has(s.organization_id)) {
        servicesByOrgId.set(s.organization_id, []);
      }
      servicesByOrgId.get(s.organization_id).push({
        id: s.id,
        serviceType: s.service_type,
        eligibilityDescription: s.eligibility_description,
        costIndicator: s.cost_indicator,
        walkInIndicator: s.walk_in_indicator === 1,
        idRequirementIndicator: s.id_requirement_indicator === 1,
      });
    }
  }

  return results.map((org) => ({
    ...org,
    services: servicesByOrgId.get(org.id) || [],
  }));
}

module.exports = { searchOrganizations };
