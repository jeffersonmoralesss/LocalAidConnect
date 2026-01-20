// Organizations API route
// Implements REQ-3.2.1 (radius search), REQ-3.2.2 (sort by distance), REQ-3.2.3 (category filter), REQ-3.2.4 (open now filter)

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
  // Handle formats like "09:00", "9:00", "09:00:00", "9:00 AM", etc.
  const match = timeStr.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  // Handle 12-hour format (assume AM/PM handling would be done elsewhere if needed)
  // For now, assume 24-hour format or handle common cases
  return hours * 60 + minutes;
}

/**
 * Check if an organization is currently open (best-effort, REQ-3.2.4)
 * Returns true if open, false if closed, null if unknown (no hours data for today)
 * @param {object} db - Database instance
 * @param {number} organizationId - Organization ID
 * @param {number|null} tzOffsetMinutes - Timezone offset in minutes (e.g., -300 for EST), null to use server time
 */
function isOpenNow(db, organizationId, tzOffsetMinutes = null) {
  // Compute current time with optional timezone offset
  let now = new Date();
  let useUTC = false;
  
  if (tzOffsetMinutes !== null) {
    // UTC → target timezone conversion:
    // 1. Get current UTC time in milliseconds (getTime() returns UTC)
    // 2. Apply target timezone offset (tzOffsetMinutes is offset FROM UTC, e.g., EST = -300)
    // 3. Create a Date from the adjusted UTC timestamp
    // 4. Use UTC methods (getUTCDay, getUTCHours) to extract components in target timezone
    const utcTimeMs = now.getTime(); // UTC milliseconds since epoch
    const targetOffsetMs = tzOffsetMinutes * 60000; // target offset in milliseconds (negative for behind UTC)
    const targetTimeMs = utcTimeMs + targetOffsetMs; // apply offset: UTC + (-300) = EST time
    now = new Date(targetTimeMs);
    useUTC = true; // use UTC methods since we've adjusted to target timezone
  }

  const currentDayOfWeek = useUTC ? now.getUTCDay() : now.getDay(); // 0=Sunday, 6=Saturday (matches schema)
  const currentHours = useUTC ? now.getUTCHours() : now.getHours();
  const currentMins = useUTC ? now.getUTCMinutes() : now.getMinutes();
  const currentTimeStr = `${currentHours.toString().padStart(2, "0")}:${currentMins.toString().padStart(2, "0")}`;
  const currentMinutes = parseTimeToMinutes(currentTimeStr);

  // Get hours for today
  const hours = db
    .prepare(
      `
      SELECT open_time, close_time, closed_indicator
      FROM hours
      WHERE organization_id = ? AND day_of_week = ?
    `
    )
    .all(organizationId, currentDayOfWeek);

  // If no hours entry for today, we can't determine (best-effort: return null = unknown)
  if (hours.length === 0) {
    return null;
  }

  // Check each hours entry (orgs can have multiple entries per day, e.g., lunch break)
  for (const entry of hours) {
    if (entry.closed_indicator === 1) {
      continue; // This entry says closed, check next one
    }

    const openMinutes = parseTimeToMinutes(entry.open_time);
    const closeMinutes = parseTimeToMinutes(entry.close_time);

    if (openMinutes === null || closeMinutes === null) {
      continue; // Invalid time format, skip this entry
    }

    // Handle case where close time is next day (e.g., 22:00 - 02:00)
    if (closeMinutes < openMinutes) {
      // Hours span midnight
      if (currentMinutes >= openMinutes || currentMinutes <= closeMinutes) {
        return true;
      }
    } else {
      // Normal hours
      if (currentMinutes >= openMinutes && currentMinutes <= closeMinutes) {
        return true;
      }
    }
  }

  // Checked all entries, none matched - organization is closed
  return false;
}

/**
 * GET /api/organizations
 * Query params:
 *   - lat: latitude (required)
 *   - lng: longitude (required)
 *   - radiusMiles: search radius in miles (default: 3, per SRS Section 3.1)
 *   - category: filter by service category (optional)
 *   - openNow: filter to organizations currently open (optional, best-effort)
 *   - tzOffsetMinutes: timezone offset in minutes for open-now evaluation (optional, e.g., -300 for EST)
 *
 * Returns organizations within radius, sorted by distance (nearest first).
 * REQ-3.2.1: returns organizations within configurable radius
 * REQ-3.2.2: sortable by distance (nearest first)
 * REQ-3.2.3: supports filtering by service category
 * REQ-3.2.4: supports "open now" filter (best-effort)
 */
function getOrganizations(req, res) {
  const db = req.app.locals.db;

  // Parse and validate query parameters
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radiusMiles =
    req.query.radiusMiles !== undefined
      ? parseFloat(req.query.radiusMiles)
      : DEFAULT_RADIUS_MILES; // REQ-3.1.x: use canonical default
  const category = req.query.category; // optional
  const openNow = req.query.openNow === "true"; // REQ-3.2.4: optional open now filter
  const tzOffsetMinutes =
    req.query.tzOffsetMinutes !== undefined
      ? parseFloat(req.query.tzOffsetMinutes)
      : null; // Optional timezone offset

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
    return res.status(400).json({
      error: "radiusMiles must be a positive number",
    });
  }

  if (tzOffsetMinutes !== null && isNaN(tzOffsetMinutes)) {
    return res.status(400).json({
      error: "tzOffsetMinutes must be a valid number if provided",
    });
  }

  // Approximate bounding box for initial filter (1 degree latitude ≈ 69 miles)
  // This is a performance optimization before calculating exact distances
  const latDelta = radiusMiles / 69;
  const lngDelta = radiusMiles / (69 * Math.cos(toRadians(lat)));

  let query;
  let params;

  if (category) {
    // REQ-3.2.3: filter by service category via join with services table
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
    params = [
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
    params = [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta];
  }

  const candidates = db.prepare(query).all(...params);

  // Calculate exact distance and filter by radius
  // REQ-3.2.1: return organizations within configurable radius
  let results = candidates
    .map((org) => {
      const distance = calculateDistance(
        lat,
        lng,
        org.latitude,
        org.longitude
      );
      return {
        ...org,
        distanceMiles: Math.round(distance * 100) / 100, // round to 2 decimals
      };
    })
    .filter((org) => org.distanceMiles <= radiusMiles);

  // REQ-3.2.4: compute openNowStatus for all orgs (for UI display)
  // Then filter if openNow=true (only include openNowStatus === true)
  results = results.map((org) => {
    const openNowStatus = isOpenNow(db, org.id, tzOffsetMinutes);
    return {
      ...org,
      openNowStatus, // true | false | null (null = unknown)
    };
  });

  // Filter by openNow if requested (strict: only include openNowStatus === true)
  if (openNow) {
    results = results.filter((org) => org.openNowStatus === true);
  }

  // REQ-3.2.2: sort by distance (nearest first)
  results.sort((a, b) => a.distanceMiles - b.distanceMiles);

  // Fetch services for all organizations in one query
  const orgIds = results.map((org) => org.id);
  let servicesByOrgId = new Map();

  if (orgIds.length > 0) {
    // Build IN clause safely (better-sqlite3 handles this, but we'll use placeholders)
    const placeholders = orgIds.map(() => "?").join(",");
    const servicesQuery = `
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
    `;
    const services = db.prepare(servicesQuery).all(...orgIds);

    // Group services by organization_id
    for (const service of services) {
      if (!servicesByOrgId.has(service.organization_id)) {
        servicesByOrgId.set(service.organization_id, []);
      }
      servicesByOrgId.get(service.organization_id).push({
        id: service.id,
        serviceType: service.service_type,
        eligibilityDescription: service.eligibility_description,
        costIndicator: service.cost_indicator,
        walkInIndicator: service.walk_in_indicator === 1,
        idRequirementIndicator: service.id_requirement_indicator === 1,
      });
    }
  }

  // Attach services array to each organization
  results = results.map((org) => ({
    ...org,
    services: servicesByOrgId.get(org.id) || [],
  }));

  // Return consistent response shape: { results: [...] }
  res.json({ results });
}

module.exports = { getOrganizations };
