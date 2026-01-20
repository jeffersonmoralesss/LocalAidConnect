const path = require("node:path");
const express = require("express");
const { openDb } = require("./db");
const { getOrganizations } = require("./routes/organizations");
const { parseQuery } = require("./routes/ai-parse");

const PORT = Number(process.env.PORT || 3001);
const DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, "..", "db", "localaid.sqlite");

// Simple in-memory rate limiter for AI endpoints (REQ-5.4)
// In production, use a proper rate limiting library like express-rate-limit
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Clean old entries
  if (rateLimitStore.has(ip)) {
    const requests = rateLimitStore.get(ip).filter((time) => time > windowStart);
    if (requests.length === 0) {
      rateLimitStore.delete(ip);
    } else {
      rateLimitStore.set(ip, requests);
    }
  }

  // Check rate limit
  const requests = rateLimitStore.get(ip) || [];
  if (requests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      error: "Rate limit exceeded. Please try again later.",
    });
  }

  // Add current request
  requests.push(now);
  rateLimitStore.set(ip, requests);

  next();
}

function main() {
  // On startup, open the SQLite DB and ensure Section 4 tables exist (REQ-4.1 → REQ-4.4).
  // The server does not implement auth/user accounts in MVP (out of scope per SRS).
  const db = openDb({ dbPath: DB_PATH });

  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // REQ-3.2.1, REQ-3.2.2, REQ-3.2.3: organization search endpoint
  app.get("/api/organizations", getOrganizations);

  // REQ-3.1.1 through REQ-3.1.6: AI parse endpoint with rate limiting (REQ-5.4)
  app.post("/api/ai/parse", rateLimitMiddleware, parseQuery);

  // Expose DB for future handlers
  app.locals.db = db;

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`LocalAid Connect server listening on :${PORT}`);
  });
}

main();

