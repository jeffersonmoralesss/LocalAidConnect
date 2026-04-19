const path = require("node:path");
const express = require("express");
const { openDb } = require("./db");
const {
  getOrganizations, getOrganizationById,
  listOrganizations, verifyOrganization, unverifyOrganization,
} = require("./routes/organizations");
const { parseQuery } = require("./routes/ai-parse");
const { postSearch } = require("./routes/search");
const { createReport, listReports, updateReportStatus } = require("./routes/reports");

const PORT = Number(process.env.PORT || 3001);
const DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, "..", "db", "localaid.sqlite");

// Simple in-memory rate limiter (REQ-5.4)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  if (rateLimitStore.has(ip)) {
    const requests = rateLimitStore.get(ip).filter((time) => time > windowStart);
    if (requests.length === 0) {
      rateLimitStore.delete(ip);
    } else {
      rateLimitStore.set(ip, requests);
    }
  }

  const requests = rateLimitStore.get(ip) || [];
  if (requests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: "Rate limit exceeded. Please try again later." });
  }

  requests.push(now);
  rateLimitStore.set(ip, requests);
  next();
}

function main() {
  const db = openDb({ dbPath: DB_PATH });

  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ── Organization search + detail (REQ-3.2, REQ-3.3) ──────────────
  app.get("/api/organizations",     getOrganizations);
  app.get("/api/organizations/:id", getOrganizationById);

  // ── AI parse (REQ-3.1) — rate limited ────────────────────────────
  app.post("/api/ai/parse", rateLimitMiddleware, parseQuery);

  // ── Unified search — parse + search + on-demand OSM import ───────
  // Rate-limited because it can trigger outbound Overpass calls.
  app.post("/api/search", rateLimitMiddleware, postSearch);

  // ── Reports (REQ-3.4) ────────────────────────────────────────────
  app.post("/api/reports", rateLimitMiddleware, createReport);

  // ── Admin moderation (REQ-3.5) ───────────────────────────────────
  // TODO: protect admin routes with token-based auth (ADMIN_TOKEN) before production.
  app.get("/api/admin/reports",              listReports);
  app.patch("/api/admin/reports/:id",        updateReportStatus);

  // ── Admin verification workflow (extension of REQ-3.5.2) ─────────
  app.get("/api/admin/organizations",                  listOrganizations);
  app.patch("/api/admin/organizations/:id/verify",     verifyOrganization);
  app.patch("/api/admin/organizations/:id/unverify",   unverifyOrganization);

  app.locals.db = db;

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`LocalAid Connect server listening on :${PORT}`);
  });
}

main();
