# Database (SQLite) – MVP

This directory contains the SQLite schema for **LocalAid Connect** MVP, implemented from `docs/LocalAid_Connect_SRS.md` **Section 4 (REQ-4.1 → REQ-4.4)**.

## Apply the schema

From the repo root:

```bash
mkdir -p server/db
sqlite3 server/db/localaid.sqlite < server/db/schema.sql
```

## Important SQLite setting

Foreign keys must be enabled per-connection:

```sql
PRAGMA foreign_keys = ON;
```

```md
## Search endpoint (AI + results)

### POST /api/search (combined)

**Example: food open now (timezone-aware)**

```bash
curl -X POST "http://localhost:3001/api/search" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "need free food pantry open now",
    "lat": 37.7749,
    "lng": -122.4194,
    "tzOffsetMinutes": -480
  }'