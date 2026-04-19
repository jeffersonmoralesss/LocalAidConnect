const fs = require("node:fs");
const path = require("node:path");
const { runMigrations } = require("./migrations");

// Load better-sqlite3 with friendly error handling for Mac build issues
let Database;
try {
  Database = require("better-sqlite3");
} catch (error) {
  if (
    error.code === "MODULE_NOT_FOUND" ||
    error.message.includes("better-sqlite3") ||
    error.message.includes("Cannot find module")
  ) {
    console.error("\n❌ Error: better-sqlite3 module not found or failed to load.");
    console.error(
      "   This is often a Mac build issue. See server/README.md 'Mac build prerequisites' section."
    );
    console.error(
      "   Common fix: Install Xcode Command Line Tools: xcode-select --install\n"
    );
    process.exit(1);
  }
  throw error;
}

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function getSchemaPath() {
  return path.join(__dirname, "..", "db", "schema.sql");
}

function ensureSchema(db) {
  // REQ-4.1 / REQ-4.2 / REQ-4.3 / REQ-4.4: ensure the required tables exist.
  const requiredTables = ["organizations", "services", "hours", "reports"];

  const existing = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name)
  );

  const missing = requiredTables.filter((t) => !existing.has(t));
  if (missing.length === 0) return;

  const schemaPath = getSchemaPath();
  if (!fileExists(schemaPath)) {
    throw new Error(`Schema file not found at ${schemaPath}`);
  }

  const ddl = fs.readFileSync(schemaPath, "utf8");
  db.exec(ddl);
}

function openDb({ dbPath }) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  // Step 1: create any missing tables (fresh DB gets the full Option-2 schema
  // because schema.sql is already updated).
  ensureSchema(db);

  // Step 2: migrate any pre-existing DB to the Option-2 shape.
  // Idempotent — no-op if already migrated.
  runMigrations(db);

  return db;
}

module.exports = { openDb };
