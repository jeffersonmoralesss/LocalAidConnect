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

The server will display a friendly error message if `better-sqlite3` fails to load, pointing to this section.

## Run

```bash
npm run dev
```

## Environment variables

- **PORT**: HTTP port (default `3001`)
- **DB_PATH**: path to SQLite DB file (default `server/db/localaid.sqlite`)
- **OPENAI_API_KEY**: OpenAI API key for AI parsing (optional, falls back to keyword extraction if not set)
- **OPENAI_MODEL**: OpenAI model to use (default `gpt-4o-mini`)

## Schema initialization

On startup, the server opens the SQLite database and ensures the Section 4 tables exist (**REQ-4.1 → REQ-4.4**).  
If any required tables are missing, it loads and executes `server/db/schema.sql`.

## API Endpoints

### Health
`GET /api/health` → `{ "ok": true }`

### Organizations Search
`GET /api/organizations?lat=<lat>&lng=<lng>&radiusMiles=<miles>&category=<category>&openNow=true&tzOffsetMinutes=<offset>`

Returns organizations within radius, sorted by distance. Implements **REQ-3.2.1–REQ-3.2.4**.

**Query parameters:**
- `lat` (required): Latitude (-90 to 90)
- `lng` (required): Longitude (-180 to 180)
- `radiusMiles` (optional): Search radius in miles (default: 3, per SRS Section 3.1)
- `category` (optional): Filter by service category (`food`, `shelter`, `medical`, `vaccines`, `mental_health`, `legal`, `other`)
- `openNow` (optional): Filter to organizations currently open (`true` to enable)
- `tzOffsetMinutes` (optional): Timezone offset in minutes for open-now evaluation (e.g., `-300` for EST, `-480` for PST). If not provided, uses server time.

**Response:**
```json
{
  "results": [
    {
      "id": 1,
      "name": "Food Bank Name",
      "address": "123 Main St",
      "latitude": 37.7749,
      "longitude": -122.4194,
      "phone": "555-0100",
      "website": "https://example.com",
      "verification_status": "VERIFIED",
      "last_verified_at": "2024-01-01",
      "distanceMiles": 0.5,
      "openNowStatus": true,
      "services": [
        {
          "id": 1,
          "serviceType": "food",
          "eligibilityDescription": "Low income",
          "costIndicator": "FREE",
          "walkInIndicator": true,
          "idRequirementIndicator": false
        }
      ]
    }
  ]
}
```

**Notes:**
- `openNowStatus`: `true` if open, `false` if closed, `null` if unknown (no hours data for today)
- Results are sorted by distance (nearest first)
- Services array is included for each organization

### AI Parse
`POST /api/ai/parse`  
Body: `{ "query": "natural language search query" }`

Parses natural language into structured JSON query. Falls back to keyword extraction if AI parsing fails. Rate limited to 10 requests/minute per IP. Implements **REQ-3.1.1–REQ-3.1.6**.

Response:
```json
{
  "query": {
    "category": "food",
    "urgency": "now",
    "radiusMiles": 3,
    "filters": {
      "openNow": true,
      "walkIn": false,
      "costFree": true,
      "noId": false
    }
  },
  "source": "ai" | "keyword"
}
```

## Example Requests

### Default radius (3 miles)

```bash
curl "http://localhost:3001/api/organizations?lat=37.7749&lng=-122.4194"
```

Returns organizations within 3 miles (default radius per SRS Section 3.1).

### Category filter

```bash
curl "http://localhost:3001/api/organizations?lat=37.7749&lng=-122.4194&category=food"
```

Returns only organizations offering food services.

### Open now filter

```bash
curl "http://localhost:3001/api/organizations?lat=37.7749&lng=-122.4194&openNow=true"
```

Returns only organizations currently open. Each result includes `openNowStatus` field.

### Timezone-aware open now

```bash
curl "http://localhost:3001/api/organizations?lat=37.7749&lng=-122.4194&openNow=true&tzOffsetMinutes=-300"
```

Uses EST timezone (-300 minutes from UTC) for open-now evaluation. Useful when server and user are in different timezones.

### Custom radius

```bash
curl "http://localhost:3001/api/organizations?lat=37.7749&lng=-122.4194&radiusMiles=10"
```

Searches within 10 miles instead of the default 3 miles.
