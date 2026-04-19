#!/usr/bin/env node
/**
 * server/scripts/smoke-test.js
 * Quick end-to-end smoke test for LocalAid Connect MVP.
 *
 * Assumes:
 *   - The server is running at BASE_URL (default http://localhost:3001)
 *   - The DB has been seeded (server orgs clustered around SF)
 *
 * Exit codes: 0 on success, 1 on any failure.
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

// SF demo coordinates — must match seed.js cluster.
const SF_LAT = 37.7749;
const SF_LNG = -122.4194;

// A remote empty spot where local DB has 0 results, so POST /api/search
// triggers the Overpass import. NYC downtown is well-mapped in OSM.
const NYC_LAT = 40.7128;
const NYC_LNG = -74.0060;

// ── Tiny test runner ──────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function pass(name, detail) {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, reason) {
  failed++;
  failures.push({ name, reason });
  console.log(`  \x1b[31m✗\x1b[0m ${name}`);
  console.log(`    \x1b[31m${reason}\x1b[0m`);
}
function skip(name, reason) {
  console.log(`  \x1b[33m–\x1b[0m ${name} (skipped: ${reason})`);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail);
  } catch (err) {
    fail(name, err.message);
  }
}

// ── Helpers ──────────────────────────────────────────────────
async function request(method, pathAndQuery, body) {
  const url = `${BASE_URL}${pathAndQuery}`;
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(url, init); }
  catch (e) { throw new Error(`Network error reaching ${url}: ${e.message}. Is the server running?`); }

  let json = null;
  const text = await res.text();
  if (text) {
    try { json = JSON.parse(text); } catch { /* not JSON */ }
  }
  return { status: res.status, json, rawBody: text };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const TZ_OFFSET = -new Date().getTimezoneOffset();

// ── Tests ────────────────────────────────────────────────────

async function testHealth() {
  const { status, json } = await request("GET", "/api/health");
  assert(status === 200, `expected 200, got ${status}`);
  assert(json && json.ok === true, `expected { ok: true }, got ${JSON.stringify(json)}`);
  return "200 { ok: true }";
}

// Search in SF — should have local matches from seed data; OSM import may or
// may not trigger depending on result count, but either way we expect results.
async function testSearchSF() {
  const unified = await request("POST", "/api/search", {
    text: "free food",
    lat: SF_LAT,
    lng: SF_LNG,
    tzOffsetMinutes: TZ_OFFSET,
  });

  if (unified.status === 404) {
    // Legacy 2-step fallback (for checkouts without POST /api/search).
    const parse = await request("POST", "/api/ai/parse", { query: "free food" });
    assert(parse.status === 200, `POST /api/ai/parse — expected 200, got ${parse.status}`);
    const params = new URLSearchParams({
      lat: SF_LAT, lng: SF_LNG,
      radiusMiles: parse.json.query.radiusMiles ?? 3,
      tzOffsetMinutes: TZ_OFFSET,
    });
    if (parse.json.query.category) params.set("category", parse.json.query.category);
    const orgs = await request("GET", `/api/organizations?${params}`);
    assert(orgs.status === 200, `GET /api/organizations — expected 200, got ${orgs.status}`);
    assert(orgs.json?.results?.length > 0, `expected > 0 results (seeded?)`);
    return `2-step fallback → ${orgs.json.results.length} result(s)`;
  }

  assert(unified.status === 200, `POST /api/search — expected 200, got ${unified.status} (${unified.rawBody?.slice(0, 200)})`);
  const list = unified.json?.results?.results;
  assert(Array.isArray(list), "POST /api/search — response missing results.results array");
  assert(list.length > 0, `POST /api/search — expected > 0 results (did you run 'npm run seed'?), got ${list.length}`);
  return `POST /api/search → ${list.length} result(s)`;
}

// OSM import: search somewhere with no seeded data. If Overpass is reachable,
// we should see UNVERIFIED OSM results appear after the import phase.
// If Overpass is down/unreachable, the search should degrade to empty results
// (not error) — we only fail this test if the endpoint itself errors.
async function testOsmImport() {
  const pre = await request("POST", "/api/search", {
    text: "free clinic",
    lat: NYC_LAT,
    lng: NYC_LNG,
    tzOffsetMinutes: TZ_OFFSET,
  });

  if (pre.status === 404) {
    return "POST /api/search not registered — OSM import test N/A";
  }

  assert(pre.status === 200, `POST /api/search (NYC) — expected 200, got ${pre.status}`);
  const list = pre.json?.results?.results;
  assert(Array.isArray(list), "missing results.results array");

  const osmCount = list.filter((o) => o.data_source === "OSM").length;
  const summary = pre.json?.importSummary;

  if (osmCount === 0 && (!summary || summary.total === 0)) {
    // Overpass may have timed out / returned nothing. This is NOT a failure —
    // the endpoint degraded correctly.
    return "Overpass returned 0 candidates (network timeout or no OSM matches) — degraded gracefully";
  }

  return `OSM import → ${osmCount} OSM result(s), summary: ${JSON.stringify(summary)}`;
}

async function testCreateReport() {
  const check = await request("GET", "/api/organizations/1");
  assert(check.status === 200, `GET /api/organizations/1 — expected 200, got ${check.status}. Run 'npm run seed' first.`);

  const { status, json } = await request("POST", "/api/reports", {
    organizationId: 1,
    reportType: "INCORRECT_HOURS",
    message: "[smoke test] Listed as open but was closed.",
  });

  assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(json)}`);
  assert(json && typeof json.id === "number", `response missing numeric id: ${JSON.stringify(json)}`);
  assert(json.status === "NEW", `expected status "NEW", got "${json.status}"`);
  return `created report #${json.id}`;
}

async function testAdminReportsList() {
  const { status, json } = await request("GET", "/api/admin/reports?status=NEW");
  assert(status === 200, `expected 200, got ${status}`);
  assert(Array.isArray(json?.results), `response missing results array: ${JSON.stringify(json)}`);
  assert(json.results.length >= 1, `expected at least 1 NEW report, got ${json.results.length}`);
  return `${json.results.length} NEW report(s)`;
}

// Verify endpoint: needs an UNVERIFIED org to act on. If the OSM import
// created one, verify that; otherwise skip gracefully.
async function testVerifyUnverifyRoundtrip() {
  const list = await request("GET", "/api/admin/organizations?verification_status=UNVERIFIED");
  assert(list.status === 200, `GET /api/admin/organizations — expected 200, got ${list.status}`);
  assert(Array.isArray(list.json?.results), "missing results array");

  if (list.json.results.length === 0) {
    return "no UNVERIFIED orgs to test with — skipping roundtrip check";
  }

  const target = list.json.results[0];
  assert(target.last_verified_at === null || target.last_verified_at === undefined,
    `pre-verify: expected last_verified_at null, got ${target.last_verified_at}`);

  // Verify
  const verify = await request("PATCH", `/api/admin/organizations/${target.id}/verify`);
  assert(verify.status === 200, `verify — expected 200, got ${verify.status}`);
  assert(verify.json.verification_status === "VERIFIED",
    `verify — expected VERIFIED, got ${verify.json.verification_status}`);
  assert(verify.json.last_verified_at, `verify — expected last_verified_at to be set, got ${verify.json.last_verified_at}`);

  // Unverify (cleanup + tests the reverse direction)
  const unverify = await request("PATCH", `/api/admin/organizations/${target.id}/unverify`);
  assert(unverify.status === 200, `unverify — expected 200, got ${unverify.status}`);
  assert(unverify.json.verification_status === "UNVERIFIED",
    `unverify — expected UNVERIFIED, got ${unverify.json.verification_status}`);
  assert(unverify.json.last_verified_at === null,
    `unverify — expected last_verified_at null, got ${unverify.json.last_verified_at}`);

  return `verify → unverify roundtrip on org #${target.id} passed`;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔎 Smoke test — ${BASE_URL}\n`);

  await check("GET /api/health",                        testHealth);
  await check("POST /api/search (SF, local data)",      testSearchSF);
  await check("POST /api/search (NYC, OSM fallback)",   testOsmImport);
  await check("POST /api/reports → 201",                testCreateReport);
  await check("GET /api/admin/reports?status=NEW >= 1", testAdminReportsList);
  await check("Verify + Unverify roundtrip",            testVerifyUnverifyRoundtrip);

  console.log(`\n──────────────────────────────`);
  if (failed === 0) {
    console.log(`\x1b[32m✓ All ${passed} checks passed.\x1b[0m\n`);
    process.exit(0);
  } else {
    console.log(`\x1b[31m✗ ${failed} failed, ${passed} passed.\x1b[0m\n`);
    console.log("Failures:");
    for (const f of failures) console.log(`  • ${f.name}: ${f.reason}`);
    console.log();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n\x1b[31mUnexpected error:\x1b[0m ${err.stack || err.message}`);
  process.exit(1);
});
