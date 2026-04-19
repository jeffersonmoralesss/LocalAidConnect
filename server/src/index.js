const path = require("node:path");
const express = require("express");
const { openDb } = require("./db");
const { getOrganizations, getOrganizationById } = require("./routes/organizations");
const { parseQuery } = require("./routes/ai-parse");
const { createReport, listReports, updateReportStatus } = require("./routes/reports");

const PORT = Number(process.env.PORT || 3001);
const DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, "..", "db", "localaid.sqlite");

// Simple in-memory rate limiter (REQ-5.4)
// Applied to AI parse and report creation endpoints.
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

  // REQ-3.2.1–3.2.4: organization list search
  app.get("/api/organizations", getOrganizations);

  // REQ-3.3.1–3.3.2: organization detail (services + hours)
  app.get("/api/organizations/:id", getOrganizationById);

  // REQ-3.1.1–3.1.6: AI parse (rate-limited per REQ-5.4)
  app.post("/api/ai/parse", rateLimitMiddleware, parseQuery);

  // REQ-3.4.1, REQ-3.4.2: user report submission (rate-limited per REQ-5.4)
  app.post("/api/reports", rateLimitMiddleware, createReport);

  // REQ-3.5.1, REQ-3.5.3: admin moderation
  // TODO: protect admin routes with token-based auth before production.
  app.get("/api/admin/reports", listReports);
  app.patch("/api/admin/reports/:id", updateReportStatus);

  app.locals.db = db;

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`LocalAid Connect server listening on :${PORT}`);
  });
}

main();
