-- LocalAid Connect - SQLite schema (MVP)
-- Source of truth: docs/LocalAid_Connect_SRS.md Section 4 (REQ-4.1 → REQ-4.4)
--
-- Notes:
-- - Enable FK enforcement when connecting: PRAGMA foreign_keys = ON;
-- - Timestamps are stored as ISO-8601 text via SQLite CURRENT_TIMESTAMP by default.
--
-- Extension (non-SRS, extension of REQ-3.5.2 admin data maintenance):
-- - last_verified_at is NULLABLE. It is NULL for UNVERIFIED entries
--   (including OSM imports). Admin verification sets it to the current timestamp.
-- - Added data_source / source_id / source_url / raw_source_json / imported_at /
--   last_seen_at columns so we can track provenance and dedupe external imports.
-- - Unique index on (data_source, source_id) prevents duplicate imports from
--   the same external source.

PRAGMA foreign_keys = ON;

-- ============================================================
-- Organization (REQ-4.1.1, REQ-4.1.2)
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- REQ-4.1.2: required org fields
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  phone TEXT NOT NULL,
  website TEXT,

  -- REQ-4.1.2: verification
  verification_status TEXT NOT NULL,
  -- CHANGED (Option 2): NULL allowed for unverified imports.
  last_verified_at TEXT,

  -- Provenance / source tracking (extension)
  data_source TEXT NOT NULL DEFAULT 'LOCAL',
  source_id TEXT,
  source_url TEXT,
  raw_source_json TEXT,
  imported_at TEXT,
  last_seen_at TEXT,

  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_organizations_lat_lng ON organizations(latitude, longitude);

-- Prevents duplicate rows for the same external source record.
-- Partial index: only enforces uniqueness when source_id is set
-- (LOCAL rows generally have source_id = NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_source
  ON organizations(data_source, source_id) WHERE source_id IS NOT NULL;

-- ============================================================
-- Service (REQ-4.2.1, REQ-4.2.2)
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  service_type TEXT NOT NULL,
  eligibility_description TEXT NOT NULL,
  cost_indicator TEXT NOT NULL,
  walk_in_indicator INTEGER NOT NULL CHECK (walk_in_indicator IN (0, 1)),
  id_requirement_indicator INTEGER NOT NULL CHECK (id_requirement_indicator IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_services_org_id ON services(organization_id);
CREATE INDEX IF NOT EXISTS idx_services_type ON services(service_type);

-- ============================================================
-- Hours (REQ-4.3.1, REQ-4.3.2)
-- ============================================================
CREATE TABLE IF NOT EXISTS hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time TEXT,
  close_time TEXT,
  closed_indicator INTEGER NOT NULL CHECK (closed_indicator IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CHECK (
    (closed_indicator = 1 AND open_time IS NULL AND close_time IS NULL)
    OR
    (closed_indicator = 0 AND open_time IS NOT NULL AND close_time IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_hours_org_id ON hours(organization_id);
CREATE INDEX IF NOT EXISTS idx_hours_org_day ON hours(organization_id, day_of_week);

-- ============================================================
-- Report (REQ-4.4.1, REQ-4.4.2)
-- ============================================================
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN (
    'INCORRECT_HOURS',
    'MOVED_LOCATION',
    'CLOSED_PERMANENTLY',
    'INCORRECT_SERVICES'
  )),
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('NEW', 'UNDER_REVIEW', 'APPLIED', 'REJECTED')),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reports_org_id ON reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
