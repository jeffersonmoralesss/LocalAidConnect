-- LocalAid Connect - SQLite schema (MVP)
-- Source of truth: docs/LocalAid_Connect_SRS.md Section 4 (REQ-4.1 → REQ-4.4)
--
-- Notes:
-- - Enable FK enforcement when connecting: PRAGMA foreign_keys = ON;
-- - Timestamps are stored as ISO-8601 text via SQLite CURRENT_TIMESTAMP by default.

PRAGMA foreign_keys = ON;

-- ============================================================
-- Organization (REQ-4.1.1, REQ-4.1.2)
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  -- REQ-4.1.1: unique identifier
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- REQ-4.1.2: required org fields
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  phone TEXT NOT NULL,
  website TEXT, -- optional (REQ-4.1.2)

  -- REQ-4.1.2: verification status + last verified timestamp
  verification_status TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,

  -- Common operational metadata (not user-facing requirements, but harmless and useful)
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_organizations_lat_lng ON organizations(latitude, longitude);

-- ============================================================
-- Service (REQ-4.2.1, REQ-4.2.2)
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- REQ-4.2.1: each org has one or more services
  organization_id INTEGER NOT NULL,

  -- REQ-4.2.2: service fields
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

  -- REQ-4.3.1: organization MAY have multiple hours entries
  organization_id INTEGER NOT NULL,

  -- REQ-4.3.2: hours fields
  -- day_of_week: 0=Sunday ... 6=Saturday (implementation convention)
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time TEXT,  -- required unless closed_indicator=1
  close_time TEXT, -- required unless closed_indicator=1
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

  -- REQ-4.4.1: report associated with an organization
  organization_id INTEGER NOT NULL,

  -- REQ-4.4.2: report fields
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

