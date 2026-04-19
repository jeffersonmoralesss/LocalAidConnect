# Server (Express + SQLite) – MVP

Minimal backend setup for **LocalAid Connect** MVP.

## Quick Demo

Three commands from a fresh checkout to a fully working backend:

```bash
npm install         # install deps
npm run demo        # seed demo data + run smoke tests
npm run dev         # start the server on :3001 (auto-reloads on file changes)
```

The `demo` script wipes and re-seeds ~18 SF-area organizations, then runs an end-to-end smoke test against a running server. If `npm run demo` reports failures, check:
- The server is running in another terminal (`npm run dev`). The smoke test hits live HTTP endpoints.
- Port 3001 isn't already taken by another process.
- `server/db/localaid.sqlite` is writable.

For the minimum viable flow: in one terminal run `npm run dev`, then in another run `npm run demo`.

## Setup

```bash
cd server
npm install
```

### Mac build prerequisites

If `npm install` fails with errors related to `better-sqlite3` (common on macOS), install Xcode Command Line Tools:

```bash
xcode-select --install
```

After installation completes, try `npm install` again. If issues persist:

1. Ensure you have a C compiler: `gcc --version` or `clang --version`
2. Try rebuilding: `npm rebuild better-sqlite3`
3. Check the [better-sqlite3 documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md) for additional troubleshooting

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start server on `:3001` with file-watch auto-reload |
| `npm start` | Start server without watch mode |
| `npm run seed` | Wipe + re-seed demo organizations, services, and hours |
| `npm run smoke` | Run end-to-end smoke tests against a running server |
| `npm run demo` | `seed` then `smoke` (convenience) |

## Environment variables

Copy `.env.example` → `.env` and adjust as needed. Summary:

- **PORT** (default `3001`): HTTP port
- **DB_PATH** (default `./db/localaid.sqlite`): SQLite file path
- **OPENAI_API_KEY** (optional): enable real LLM query parsing; without it the API falls back to keyword extraction
- **OPENAI_MODEL** (default `gpt-4o-mini`)
- **ADMIN_TOKEN** (placeholder — not enforced yet): reserved for future admin-route auth

## Seed demo data

```bash
npm run seed
```

Wipes `reports`, `services`, `hours`, `organizations` and re-inserts ~18 fictitious organizations clustered around **San Francisco (lat=37.7749, lng=-122.4194)**, covering every category (`food`, `shelter`, `medical`, `vaccines`, `mental_health`, `legal`, `other`). Each org gets at least one service and 7 hours rows, with a mix of always-open and realistic schedules so `openNowStatus: true` results are guaranteed for demos.

## Smoke tests

```bash
npm run smoke
```

Checks, in order:
1. `GET /api/health` returns `{ ok: true }`
2. Search returns at least one result near SF (tries `POST /api/search` first, falls back to `POST /api/ai/parse` + `GET /api/organizations` if the unified endpoint isn't registered)
3. `POST /api/reports` returns 201 with a created report
4. `GET /api/admin/reports?status=NEW` returns at least 1 report

Exit code `0` on success, `1` on any failure. Failures print the specific endpoint, status code, and response body for quick diagnosis.

`BASE_URL` env var can override the target (defaults to `http://localhost:3001`).

## API Endpoints

### Health
`GET /api/health` → `{ "ok": true }`

### Organizations list
`GET /api/organizations?lat=<lat>&lng=<lng>&radiusMiles=<miles>&category=<category>&openNow=true&tzOffsetMinutes=<offset>`  
Implements **REQ-3.2.1–REQ-3.2.4**.

### Organization detail
`GET /api/organizations/:id`  
Returns org + services + 7-day hours. Implements **REQ-3.3.1, REQ-3.3.2**.

### AI Parse
`POST /api/ai/parse` — body `{ "query": "natural language search query" }`  
Rate limited to 10 requests/minute per IP. Implements **REQ-3.1.1–REQ-3.1.6**.

### Report an issue
`POST /api/reports` — **REQ-3.4.1, REQ-3.4.2**. Rate limited.

Body:
```json
{
  "organizationId": 1,
  "reportType": "INCORRECT_HOURS",
  "message": "Listed open Saturday but was closed when I visited."
}
```

Valid `reportType`: `INCORRECT_HOURS`, `MOVED_LOCATION`, `CLOSED_PERMANENTLY`, `INCORRECT_SERVICES`.

### Admin: list reports
`GET /api/admin/reports?status=NEW|UNDER_REVIEW|APPLIED|REJECTED` — **REQ-3.5.1**. `status` optional.

### Admin: update status
`PATCH /api/admin/reports/:id` — body `{ "status": "UNDER_REVIEW" | "APPLIED" | "REJECTED" }`. **REQ-3.5.3**.

> Admin routes are unauthenticated in MVP. See `TODO` in `src/index.js` and `ADMIN_TOKEN` placeholder in `.env.example`.

## Sanity curls

```bash
# Health
curl -i http://localhost:3001/api/health

# Organizations search
curl -i "http://localhost:3001/api/organizations?lat=37.7749&lng=-122.4194&radiusMiles=5"

# Organization detail
curl -i http://localhost:3001/api/organizations/1

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

## Troubleshooting: `POST /api/reports` returns 404

A 404 from the server (not from the Vite proxy) means Express has no route matching that path. Check in this order:

1. **Is the handler file present?** `ls server/src/routes/reports.js`
2. **Are the routes registered in `index.js`?** `grep -n "reports" server/src/index.js` — you should see `require("./routes/reports")` and an `app.post("/api/reports"…)` line.
3. **Did the dev server restart?** `node --watch` usually reloads, but if an error surfaces it may have crashed. Ctrl-C and `npm run dev` again.
4. **Is the frontend hitting the right URL?** DevTools → Network → the request URL should be `/api/reports`, not `/reports`.
5. **Bypass the Vite proxy** — hit the backend directly via curl. If curl works but the UI doesn't, the bug is on the frontend.
