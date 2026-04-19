// Reports API routes
// REQ-3.4.1, REQ-3.4.2, REQ-3.4.3 — user-submitted reports
// REQ-3.5.1, REQ-3.5.3 — admin moderation (list + status update)

const VALID_REPORT_TYPES = [
  "INCORRECT_HOURS",
  "MOVED_LOCATION",
  "CLOSED_PERMANENTLY",
  "INCORRECT_SERVICES",
];

// NEW is assigned on creation; only these 3 are valid transitions via PATCH.
const VALID_PATCH_STATUSES = ["UNDER_REVIEW", "APPLIED", "REJECTED"];

const VALID_LIST_STATUSES = ["NEW", "UNDER_REVIEW", "APPLIED", "REJECTED"];

const MAX_MESSAGE_LENGTH = 2000;

// ─────────────────────────────────────────────────────────────────
// POST /api/reports
// Body: { organizationId, reportType, message }
// Creates a new report with status="NEW".
// REQ-3.4.1, REQ-3.4.2
// ─────────────────────────────────────────────────────────────────
function createReport(req, res) {
  const db = req.app.locals.db;
  const { organizationId, reportType, message } = req.body || {};

  // ── Validate organizationId ────────────────────────────────────
  const orgId = Number(organizationId);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    return res.status(400).json({
      error: "organizationId is required and must be a positive integer",
    });
  }

  // ── Validate reportType ────────────────────────────────────────
  if (!reportType || !VALID_REPORT_TYPES.includes(reportType)) {
    return res.status(400).json({
      error: `reportType must be one of: ${VALID_REPORT_TYPES.join(", ")}`,
    });
  }

  // ── Validate message ───────────────────────────────────────────
  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({
      error: "message is required and must be a non-empty string",
    });
  }
  const trimmedMessage = message.trim();
  if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({
      error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
    });
  }

  // ── Verify org exists (nicer error than FK failure) ────────────
  const org = db
    .prepare("SELECT id FROM organizations WHERE id = ?")
    .get(orgId);
  if (!org) {
    return res.status(404).json({ error: "Organization not found" });
  }

  // ── Insert ─────────────────────────────────────────────────────
  const info = db
    .prepare(
      `INSERT INTO reports (organization_id, report_type, message, status)
       VALUES (?, ?, ?, 'NEW')`
    )
    .run(orgId, reportType, trimmedMessage);

  const created = db
    .prepare(
      `SELECT id, organization_id, report_type, message, status, created_at
       FROM reports WHERE id = ?`
    )
    .get(info.lastInsertRowid);

  res.status(201).json({
    id: created.id,
    organizationId: created.organization_id,
    reportType: created.report_type,
    message: created.message,
    status: created.status,
    createdAt: created.created_at,
  });
}

// ─────────────────────────────────────────────────────────────────
// GET /api/admin/reports?status=NEW|UNDER_REVIEW|APPLIED|REJECTED
// Admin list with org info joined in.
// REQ-3.5.1
// TODO: protect with token-based auth before shipping outside MVP.
// ─────────────────────────────────────────────────────────────────
function listReports(req, res) {
  const db = req.app.locals.db;
  const statusFilter = req.query.status;

  if (statusFilter !== undefined && !VALID_LIST_STATUSES.includes(statusFilter)) {
    return res.status(400).json({
      error: `status must be one of: ${VALID_LIST_STATUSES.join(", ")}`,
    });
  }

  let rows;
  if (statusFilter) {
    rows = db
      .prepare(
        `SELECT r.id, r.organization_id, r.report_type, r.message, r.status, r.created_at,
                o.name AS organization_name, o.address AS organization_address
         FROM reports r
         INNER JOIN organizations o ON o.id = r.organization_id
         WHERE r.status = ?
         ORDER BY r.created_at DESC`
      )
      .all(statusFilter);
  } else {
    rows = db
      .prepare(
        `SELECT r.id, r.organization_id, r.report_type, r.message, r.status, r.created_at,
                o.name AS organization_name, o.address AS organization_address
         FROM reports r
         INNER JOIN organizations o ON o.id = r.organization_id
         ORDER BY r.created_at DESC`
      )
      .all();
  }

  const results = rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    organizationAddress: r.organization_address,
    reportType: r.report_type,
    message: r.message,
    status: r.status,
    createdAt: r.created_at,
  }));

  res.json({ results });
}

// ─────────────────────────────────────────────────────────────────
// PATCH /api/admin/reports/:id
// Body: { status }
// Update report status. REQ-3.5.3
// TODO: protect with token-based auth before shipping outside MVP.
// ─────────────────────────────────────────────────────────────────
function updateReportStatus(req, res) {
  const db = req.app.locals.db;
  const reportId = parseInt(req.params.id, 10);
  const { status } = req.body || {};

  if (!Number.isInteger(reportId) || reportId <= 0) {
    return res.status(400).json({ error: "id must be a positive integer" });
  }

  if (!status || !VALID_PATCH_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `status must be one of: ${VALID_PATCH_STATUSES.join(", ")}`,
    });
  }

  const existing = db
    .prepare("SELECT id FROM reports WHERE id = ?")
    .get(reportId);
  if (!existing) {
    return res.status(404).json({ error: "Report not found" });
  }

  db.prepare("UPDATE reports SET status = ? WHERE id = ?").run(status, reportId);

  const updated = db
    .prepare(
      `SELECT r.id, r.organization_id, r.report_type, r.message, r.status, r.created_at,
              o.name AS organization_name, o.address AS organization_address
       FROM reports r
       INNER JOIN organizations o ON o.id = r.organization_id
       WHERE r.id = ?`
    )
    .get(reportId);

  res.json({
    id: updated.id,
    organizationId: updated.organization_id,
    organizationName: updated.organization_name,
    organizationAddress: updated.organization_address,
    reportType: updated.report_type,
    message: updated.message,
    status: updated.status,
    createdAt: updated.created_at,
  });
}

module.exports = { createReport, listReports, updateReportStatus };
