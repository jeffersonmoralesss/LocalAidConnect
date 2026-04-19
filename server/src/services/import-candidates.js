// server/src/services/import-candidates.js
//
// Takes normalized candidates from the Overpass provider and upserts them
// into the organizations table as UNVERIFIED entries.
//
// Trust rules (CRITICAL):
//   - UNVERIFIED imports always have last_verified_at = NULL.
//   - We NEVER modify a VERIFIED org's fields automatically. If a source
//     matches a verified org (same data_source+source_id), we only update
//     last_seen_at so we know the source still mentions it.
//   - For UNVERIFIED rows on re-import, we fill in missing contact fields
//     (phone, website, address) but don't overwrite ones already set.

const nowIso = () => new Date().toISOString();

// ─── Service-type inference from category ─────────────────────────────────
function serviceTypeFromCategory(category) {
  const allowed = [
    "food", "shelter", "medical", "vaccines",
    "mental_health", "legal", "other",
  ];
  return allowed.includes(category) ? category : "other";
}

// ─── Upsert one candidate ─────────────────────────────────────────────────
/**
 * Upsert a single candidate. Returns { orgId, action } where action is
 * one of: "inserted" | "touched_verified" | "updated_unverified" | "skipped".
 */
function upsertCandidate(db, candidate, category) {
  const sourceType = candidate.sourceType;   // e.g., "OSM"
  const sourceId   = candidate.sourceId;     // e.g., "node/12345"

  // Minimum required fields for a usable row:
  if (!candidate.name || typeof candidate.latitude !== "number" || typeof candidate.longitude !== "number") {
    return { orgId: null, action: "skipped" };
  }

  // Address, phone, website may be missing from OSM. Schema requires
  // non-null address + phone, so substitute safe placeholders. These are
  // visibly empty-ish in the UI and stay editable by admins.
  const address = candidate.address ?? "Address not available";
  const phone   = candidate.phone   ?? "";

  const existing = db.prepare(`
    SELECT id, verification_status, address, phone, website
    FROM organizations
    WHERE data_source = ? AND source_id = ?
  `).get(sourceType, sourceId);

  const ts = nowIso();

  if (existing) {
    if (existing.verification_status === "VERIFIED") {
      // Hands-off. Just note that the source still references it.
      db.prepare(`UPDATE organizations SET last_seen_at = ? WHERE id = ?`)
        .run(ts, existing.id);
      return { orgId: existing.id, action: "touched_verified" };
    }

    // UNVERIFIED: fill missing fields only.
    db.prepare(`
      UPDATE organizations SET
        address = CASE WHEN (address IS NULL OR address = '' OR address = 'Address not available')
                       THEN ? ELSE address END,
        phone   = CASE WHEN (phone IS NULL OR phone = '')
                       THEN ? ELSE phone END,
        website = CASE WHEN (website IS NULL OR website = '')
                       THEN ? ELSE website END,
        last_seen_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(address, phone, candidate.website, ts, ts, existing.id);
    return { orgId: existing.id, action: "updated_unverified" };
  }

  // Insert new UNVERIFIED row.
  const info = db.prepare(`
    INSERT INTO organizations (
      name, address, latitude, longitude, phone, website,
      verification_status, last_verified_at,
      data_source, source_id, source_url, raw_source_json,
      imported_at, last_seen_at
    ) VALUES (
      @name, @address, @latitude, @longitude, @phone, @website,
      'UNVERIFIED', NULL,
      @sourceType, @sourceId, @sourceUrl, @rawJson,
      @ts, @ts
    )
  `).run({
    name:      candidate.name,
    address,
    latitude:  candidate.latitude,
    longitude: candidate.longitude,
    phone,
    website:   candidate.website,
    sourceType,
    sourceId,
    sourceUrl: candidate.sourceUrl,
    rawJson:   candidate.rawTags ? JSON.stringify(candidate.rawTags) : null,
    ts,
  });

  const newId = info.lastInsertRowid;

  // Seed a minimal services row so category search matches this org.
  db.prepare(`
    INSERT INTO services (
      organization_id, service_type, eligibility_description,
      cost_indicator, walk_in_indicator, id_requirement_indicator
    ) VALUES (?, ?, ?, 'UNKNOWN', 0, 0)
  `).run(
    newId,
    serviceTypeFromCategory(category),
    "Imported from OpenStreetMap. Eligibility not yet verified — call ahead."
  );

  // We intentionally do NOT insert hours rows. opening_hours parsing is
  // non-trivial (OSM opening_hours spec is complex) and incorrect hours
  // are worse than missing hours. The org query already returns
  // openNowStatus: null when no hours data exists.

  return { orgId: newId, action: "inserted" };
}

/**
 * Import a batch of candidates. Returns a summary object.
 */
function importCandidates(db, candidates, category) {
  const summary = {
    total: candidates.length,
    inserted: 0,
    updated: 0,
    touched: 0,
    skipped: 0,
  };

  // Wrap in a single transaction for speed + atomicity.
  const tx = db.transaction(() => {
    for (const c of candidates) {
      const { action } = upsertCandidate(db, c, category);
      if      (action === "inserted")            summary.inserted++;
      else if (action === "updated_unverified")  summary.updated++;
      else if (action === "touched_verified")    summary.touched++;
      else                                       summary.skipped++;
    }
  });

  tx();
  return summary;
}

module.exports = { importCandidates, _internal: { upsertCandidate } };
