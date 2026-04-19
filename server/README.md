# Server (Express + SQLite) – MVP

Minimal backend setup for **LocalAid Connect** MVP.

## Quick Demo

```bash
npm install
npm run demo        # seed + smoke tests
npm run dev         # start server on :3001
```

`npm run demo` wipes + re-seeds ~18 SF-area orgs and runs the end-to-end smoke test. The smoke test needs the server already running (`npm run dev` in another terminal).

## Setup

```bash
cd server
npm install
```

### Mac build prerequisites

If `npm install` fails on `better-sqlite3`, install Xcode Command Line Tools:

```bash
xcode-select --install
npm rebuild better-sqlite3   # if still failing after xcode install
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start server on `:3001` with file-watch auto-reload |
| `npm start` | Start server without watch mode |
| `npm run seed` | Wipe + re-seed demo organizations, services, and hours |
| `npm run smoke` | Run end-to-end smoke tests against a running server |
| `npm run demo` | `seed` then `smoke` (convenience) |

## Environment variables

Copy `.env.example` → `.env` and adjust as needed.

- **PORT** (default `3001`)
- **DB_PATH** (default `./db/localaid.sqlite`)
- **OPENAI_API_KEY** (optional — enables real LLM parsing; without it, keyword fallback is used)
- **OPENAI_MODEL** (default `gpt-4o-mini`)
- **ADMIN_TOKEN** (reserved — admin routes are currently unauthenticated)

---

## Data model & trust (important)

LocalAid Connect has two classes of organization data, distinguished by two columns:

| Column | Value | Meaning |
|---|---|---|
| `verification_status` | `VERIFIED` | An admin has reviewed and confirmed this listing |
| `verification_status` | `UNVERIFIED` | Imported from an external source, not yet reviewed |
| `last_verified_at` | `ISO timestamp` | When an admin last verified this listing |
| `last_verified_at` | `NULL` | Never been verified (strictly implies `UNVERIFIED`) |
| `data_source` | `LOCAL` | Curated demo data (from `npm run seed`) |
| `data_source` | `OSM` | Imported on-demand from OpenStreetMap |

The invariant: **`last_verified_at` is NULL if and only if the listing has never been admin-verified.** This is preserved through imports, edits, and the `unverify` endpoint.

### Migrations

On server boot, `src/db.js` opens the SQLite file, creates any missing tables, then runs `src/migrations.js`. The Option-2 migration detects whether `last_verified_at` is still `NOT NULL` (or whether provenance columns are missing) and rebuilds the `organizations` table in place:

- Transaction-wrapped, with `foreign_keys` toggled off → on around the DDL
- Preserves every existing `id`, so `services` / `hours` / `reports` foreign keys stay intact
- Runs `PRAGMA foreign_key_check` after the migration and throws if anything is broken
- Idempotent — safe to re-run; does nothing on already-migrated DBs

---

## OSM on-demand import

When `POST /api/search` finds fewer than **5** local matches *and* a category was parsed from the query, the server calls the public Overpass API for nearby candidates, upserts them as `UNVERIFIED` rows, and re-runs the DB query so fresh results appear in the same response.

### Upsert rules

- **Dedup key**: `(data_source, source_id)` — enforced by unique partial index
- **New candidate** → inserted with `verification_status='UNVERIFIED'`, `last_verified_at=NULL`
- **Match exists & VERIFIED** → `last_seen_at` is updated; **nothing else changes**
- **Match exists & UNVERIFIED** → missing contact fields (phone/website/address) are filled in; existing values are never overwritten

A minimal `services` row is seeded per import (category inferred from the query, `cost_indicator='UNKNOWN'`). Hours are intentionally *not* imported — OSM's `opening_hours` format is complex and wrong hours are worse than missing hours. The UI shows "Hours unknown" in that case.

### Caching & rate limiting

- In-memory cache keyed by `round(lat, 2) | round(lng, 2) | category | radius`
- TTL: **6 hours**
- Per-request Overpass timeout: **6 seconds**
- Element cap: **50 per call**
- Overpass failures never fail the search — they silently fall back to local results

### Provider limitations

- Public Overpass endpoint is rate-limited globally. For production load you would self-host or use a commercial mirror.
- Tag selectors are conservative (high precision, moderate recall). Some legitimate social services won't be tagged correctly in OSM.
- Address/phone coverage varies wildly by region. OSM imports often arrive with empty `phone` — the UI handles this by not rendering the Call button.

---

## Admin verification workflow

1. User runs a search that triggers an OSM import → new `UNVERIFIED` rows appear
2. Results show them with an amber "Not verified yet" badge and a grey `OSM` source chip
3. Admin goes to `/#admin` → **Unverified organizations** tab
4. Admin reviews the listing, optionally clicks through to the OSM source URL, then clicks **Verify**
5. `PATCH /api/admin/organizations/:id/verify` sets `verification_status='VERIFIED'` and `last_verified_at=now()`
6. Subsequent searches show the listing with the green "Verified" badge

If a report or admin review invalidates a previously-verified listing, `PATCH /api/admin/organizations/:id/unverify` resets `verification_status` to `UNVERIFIED` and **clears `last_verified_at` back to `NULL`**.

### ⚠️ Admin routes are not yet authenticated

All `/api/admin/*` routes are currently accessible without auth. This is flagged with `TODO` comments in `src/index.js` and a placeholder `ADMIN_TOKEN` in `.env.example`. Do not expose this server publicly until auth is added.

---

## API Endpoints

### Health
`GET /api/health` → `{ "ok": true }`

### Organizations list
`GET /api/organizations?lat=<lat>&lng=<lng>&radiusMiles=<miles>&category=<category>&openNow=true&tzOffsetMinutes=<offset>`

Implements **REQ-3.2.1–REQ-3.2.4**. Each result includes `verification_status`, `last_verified_at` (may be `null`), `data_source`, `source_id`, `source_url`.

### Organization detail
`GET /api/organizations/:id`

Returns the full org with services + 7-day hours. Implements **REQ-3.3.1, REQ-3.3.2**.

### AI Parse
`POST /api/ai/parse` — body `{ "query": "…" }`. Rate limited. Implements **REQ-3.1.1–REQ-3.1.6**.

### Unified search (with on-demand OSM import)
`POST /api/search` — body `{ "text": "…", "lat": …, "lng": …, "tzOffsetMinutes": … }`. Rate limited.

Returns:
```json
{
  "source": "ai | keyword",
  "parsedQuery": { "category": "food", "urgency": "now", "radiusMiles": 3, "filters": {…} },
  "results": { "results": [ /* orgs */ ] },
  "importSummary": null | { "total": 12, "inserted": 8, "updated": 2, "touched": 1, "skipped": 1 }
}
```

`importSummary` is non-null only when an OSM import was triggered.

### Report an issue
`POST /api/reports` — body `{ organizationId, reportType, message }`. Rate limited. **REQ-3.4**.

### Admin: reports
- `GET  /api/admin/reports?status=NEW|UNDER_REVIEW|APPLIED|REJECTED` — **REQ-3.5.1**
- `PATCH /api/admin/reports/:id` with `{ status }` — **REQ-3.5.3**

### Admin: verification
- `GET  /api/admin/organizations?verification_status=VERIFIED|UNVERIFIED|PENDING` — list orgs filtered by status
- `PATCH /api/admin/organizations/:id/verify` — mark verified, set `last_verified_at=now()`
- `PATCH /api/admin/organizations/:id/unverify` — reset to unverified, `last_verified_at=NULL`

---

## Sanity curls

```bash
# Health
curl -i http://localhost:3001/api/health

# Unified search (triggers OSM import if local matches < 5)
curl -i -X POST http://localhost:3001/api/search \
  -H "Content-Type: application/json" \
  -d '{"text":"free food open now","lat":37.7749,"lng":-122.4194,"tzOffsetMinutes":-420}'

# List unverified organizations
curl -i "http://localhost:3001/api/admin/organizations?verification_status=UNVERIFIED"

# Verify an org (use an id from the previous call)
curl -i -X PATCH http://localhost:3001/api/admin/organizations/42/verify

# Unverify an org
curl -i -X PATCH http://localhost:3001/api/admin/organizations/42/unverify

# Submit a report
curl -i -X POST http://localhost:3001/api/reports \
  -H "Content-Type: application/json" \
  -d '{"organizationId":1,"reportType":"INCORRECT_HOURS","message":"Phone disconnected."}'

# Admin: list NEW reports
curl -i "http://localhost:3001/api/admin/reports?status=NEW"

# Admin: mark report 1 as applied
curl -i -X PATCH http://localhost:3001/api/admin/reports/1 \
  -H "Content-Type: application/json" \
  -d '{"status":"APPLIED"}'
```

---

## Troubleshooting

**`POST /api/reports` returns 404** — check that `src/routes/reports.js` exists and that `src/index.js` has `require("./routes/reports")` plus the three `app.post/get/patch` registrations. `grep -n "reports" src/index.js`.

**`POST /api/search` returns results but no OSM imports appear** — either (a) the query category came back as `"other"` (imports only trigger when a specific category is parsed), (b) local DB already has ≥5 matches, (c) Overpass timed out or returned no candidates. Check server logs for `[overpass]` warnings.

**Migration hangs or errors on startup** — if the DB is in a weird state, the safest reset is:
```bash
rm server/db/localaid.sqlite
npm run seed
```
Only do this on demo/dev databases; migration is designed to preserve prod data.

**Every search triggers a fresh Overpass call** — check that the in-memory cache isn't being invalidated by server restarts during dev. `node --watch` restarts the process on every file save, which clears the cache. This is harmless but noisy.
