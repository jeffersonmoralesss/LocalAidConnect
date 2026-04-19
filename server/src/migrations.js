// server/src/migrations.js
//
// SQLite-safe migrations. SQLite can't ALTER a column's NOT NULL constraint,
// so we use the classic "new table + copy + drop + rename" pattern.
//
// Every migration is:
//   - Idempotent: safe to re-run (detects current schema state first).
//   - Wrapped in a transaction.
//   - Foreign-key-safe: disables FK enforcement only for the DDL step that
//     rotates the table, then re-enables it.

/**
 * Returns true if the `organizations` table needs the Option-2 migration:
 *   - last_verified_at is currently NOT NULL, OR
 *   - any of the new provenance columns are missing, OR
 *   - the unique (data_source, source_id) index is missing.
 */
function needsOrganizationsMigration(db) {
  const cols = db.prepare("PRAGMA table_info(organizations)").all();
  if (cols.length === 0) return false; // Fresh DB — schema.sql creates it directly.

  const byName = new Map(cols.map((c) => [c.name, c]));

  // 1. last_verified_at must be nullable.
  const lv = byName.get("last_verified_at");
  if (!lv) return true;                  // missing entirely — need migration
  if (lv.notnull === 1) return true;     // still NOT NULL

  // 2. All new columns must exist.
  const requiredNew = [
    "data_source", "source_id", "source_url",
    "raw_source_json", "imported_at", "last_seen_at",
  ];
  for (const name of requiredNew) {
    if (!byName.has(name)) return true;
  }

  // 3. Unique index on (data_source, source_id) must exist.
  const indexes = db.prepare("PRAGMA index_list(organizations)").all();
  const hasSourceIdx = indexes.some((i) => i.name === "idx_organizations_source");
  if (!hasSourceIdx) return true;

  return false;
}

/**
 * Migrate organizations table to Option-2 shape:
 *   - last_verified_at TEXT NULLABLE
 *   - data_source, source_id, source_url, raw_source_json, imported_at, last_seen_at
 *   - unique partial index on (data_source, source_id) WHERE source_id IS NOT NULL
 *
 * Copies all existing rows. Preserves IDs so FK references in
 * services/hours/reports remain valid.
 */
function migrateOrganizationsToOption2(db) {
  // Must be OFF during the drop+rename dance; otherwise dependent tables
  // would have their FK constraints flagged as violated mid-transaction.
  db.pragma("foreign_keys = OFF");

  const tx = db.transaction(() => {
    // 1. Create the new table with the target shape.
    db.exec(`
      CREATE TABLE organizations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        phone TEXT NOT NULL,
        website TEXT,
        verification_status TEXT NOT NULL,
        last_verified_at TEXT,                       -- now NULLABLE
        data_source TEXT NOT NULL DEFAULT 'LOCAL',
        source_id TEXT,
        source_url TEXT,
        raw_source_json TEXT,
        imported_at TEXT,
        last_seen_at TEXT,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      );
    `);

    // 2. Copy data. We SELECT each existing column explicitly; missing columns
    //    on the source side get sensible defaults. This keeps the migration
    //    forward-compatible with partial prior upgrades.
    const existingCols = new Set(
      db.prepare("PRAGMA table_info(organizations)").all().map((c) => c.name)
    );

    // Pick from source with fallback literals for columns that might not exist yet.
    const sel = (col, fallback) => existingCols.has(col) ? col : fallback;

    db.exec(`
      INSERT INTO organizations_new (
        id, name, address, latitude, longitude, phone, website,
        verification_status, last_verified_at,
        data_source, source_id, source_url, raw_source_json,
        imported_at, last_seen_at, created_at, updated_at
      )
      SELECT
        id, name, address, latitude, longitude, phone, website,
        verification_status,
        ${sel("last_verified_at", "NULL")},
        ${sel("data_source", "'LOCAL'")},
        ${sel("source_id", "NULL")},
        ${sel("source_url", "NULL")},
        ${sel("raw_source_json", "NULL")},
        ${sel("imported_at", "NULL")},
        ${sel("last_seen_at", "NULL")},
        ${sel("created_at", "CURRENT_TIMESTAMP")},
        ${sel("updated_at", "CURRENT_TIMESTAMP")}
      FROM organizations;
    `);

    // 3. Drop the old table and rename the new one into place.
    //    FK cascades in services/hours/reports stay intact because their
    //    FK is declared against "organizations" by name — as long as the
    //    new table has the same name and same id column, references resolve.
    db.exec(`DROP TABLE organizations;`);
    db.exec(`ALTER TABLE organizations_new RENAME TO organizations;`);

    // 4. Recreate indexes (dropped with the old table).
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_organizations_lat_lng
        ON organizations(latitude, longitude);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_source
        ON organizations(data_source, source_id) WHERE source_id IS NOT NULL;
    `);
  });

  try {
    tx();
  } finally {
    // Re-enable FK enforcement even if the transaction failed.
    db.pragma("foreign_keys = ON");
  }

  // Sanity: confirm FK integrity of the whole DB.
  const fkErrors = db.pragma("foreign_key_check");
  if (Array.isArray(fkErrors) && fkErrors.length > 0) {
    throw new Error(
      `FK integrity check failed after organizations migration: ${JSON.stringify(fkErrors)}`
    );
  }
}

/**
 * Entry point — runs all pending migrations.
 */
function runMigrations(db) {
  if (needsOrganizationsMigration(db)) {
    // eslint-disable-next-line no-console
    console.log("[migrations] migrating organizations to Option-2 schema…");
    migrateOrganizationsToOption2(db);
    // eslint-disable-next-line no-console
    console.log("[migrations] organizations migration complete.");
  }
}

module.exports = { runMigrations, needsOrganizationsMigration };
