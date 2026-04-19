# Server (Express + SQLite) – MVP

Minimal backend setup for **LocalAid Connect** MVP.

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

## Run

```bash
npm run dev
```

## Seed demo data

```bash
npm run seed
```

Wipes the database and re-inserts ~18 fictitious organizations clustered around **San Francisco (lat=37.7749, lng=-122.4194)**, each with services and 7-day hours rows.

## Environment variables

- **PORT**: HTTP port (default `3001`)
- **DB_PATH**: path to SQLite DB file (default `server/db/localaid.sqlite`)
- **OPENAI_API_KEY**: OpenAI API key for AI parsing (optional, falls back to keyword extraction)
- **OPENAI_MODEL**: OpenAI model to use (default `gpt-4o-mini`)

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

> Admin routes are unauthenticated in MVP. See `TODO` comment in `src/index.js`.

## Sanity checks

Run these after starting the server (`npm run dev`) to verify every route is live. Use `-i` so headers (and the status code) always print, even on success.

```bash
# Health — should return 200 + {"ok":true}
curl -i http://localhost:3001/api/health

# Organizations search — 200 + { "results": [...] }
curl -i "http://localhost:3001/api/organizations?lat=37.7749&lng=-122.4194&radiusMiles=5"

# Organization detail — 200 + full org with services + hours
curl -i http://localhost:3001/api/organizations/1

# Submit a report — should return 201 with the created row
curl -i -X POST http://localhost:3001/api/reports \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": 1,
    "reportType": "INCORRECT_HOURS",
    "message": "Phone number is disconnected."
  }'

# Admin: list NEW reports
curl -i "http://localhost:3001/api/admin/reports?status=NEW"

# Admin: mark report 1 as applied
curl -i -X PATCH http://localhost:3001/api/admin/reports/1 \
  -H "Content-Type: application/json" \
  -d '{"status":"APPLIED"}'
```

### Troubleshooting: `POST /api/reports` returns 404

A 404 from the server (not from the Vite proxy) means Express has no route matching that path. Check in this order:

1. **Is the handler file present?** `ls server/src/routes/reports.js` — if missing, the server still starts because `index.js` would fail to import and crash; check terminal output for a `MODULE_NOT_FOUND` error.
2. **Are the routes registered in `index.js`?**
   ```bash
   grep -n "reports" server/src/index.js
   ```
   You should see lines requiring the handlers and registering all three routes (`POST /api/reports`, `GET /api/admin/reports`, `PATCH /api/admin/reports/:id`).
3. **Did the dev server restart?** `node --watch` usually reloads on file changes, but if the terminal shows an error, fix it and restart manually:
   ```bash
   # Ctrl-C to stop, then
   npm run dev
   ```
4. **Is the frontend hitting the right URL?** Open the browser devtools → Network tab → click Submit on the report form. The request should go to `http://localhost:5173/api/reports` and be proxied to `http://localhost:3001/api/reports`. If the request URL is `/reports` (no `/api` prefix), the fetch call in `OrgDetailModal.jsx` is wrong.
5. **Bypass the Vite proxy** — hit the backend directly with the curl above. If curl works but the UI doesn't, the bug is on the frontend side.
