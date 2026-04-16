#!/usr/bin/env node
/**
 * server/scripts/seed.js
 * Populates server/db/localaid.sqlite with demo organizations for LocalAid Connect.
 *
 * Strategy A: wipe + re-insert (idempotent, safe for MVP demo).
 * Run: node scripts/seed.js  (or: npm run seed from server/)
 *
 * Implements data for REQ-4.1 → REQ-4.4.
 * All orgs are fictitious and placed around San Francisco (37.77, -122.41).
 */

const path = require("node:path");
const Database = require("better-sqlite3");

const DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, "..", "db", "localaid.sqlite");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build 7 hours rows for an org. Pass an array of { days[], open, close }
 *  where days is an array of day_of_week ints (0=Sun…6=Sat).
 *  Days not covered get closed_indicator=1.
 *  Pass open/close as "HH:MM" 24-hr strings.
 *  Use open="00:00" close="23:59" for "always open" demo purposes. */
function buildHours(schedule) {
  // schedule: [{ days: [1,2,3,4,5], open: "08:00", close: "18:00" }, ...]
  const covered = new Map();
  for (const { days, open, close } of schedule) {
    for (const d of days) {
      covered.set(d, { open, close });
    }
  }
  const rows = [];
  for (let d = 0; d <= 6; d++) {
    if (covered.has(d)) {
      const { open, close } = covered.get(d);
      rows.push({ day_of_week: d, open_time: open, close_time: close, closed_indicator: 0 });
    } else {
      rows.push({ day_of_week: d, open_time: null, close_time: null, closed_indicator: 1 });
    }
  }
  return rows;
}

// Always open — guarantees openNow=true for demo regardless of when seed runs.
const ALWAYS = buildHours([{ days: [0,1,2,3,4,5,6], open: "00:00", close: "23:59" }]);

// Weekdays 8am-6pm
const WEEKDAYS_8_18 = buildHours([{ days: [1,2,3,4,5], open: "08:00", close: "18:00" }]);

// Weekdays + Sat 9am-5pm
const WEEKDAYS_SAT_9_17 = buildHours([
  { days: [1,2,3,4,5], open: "09:00", close: "17:00" },
  { days: [6],         open: "09:00", close: "13:00" },
]);

// Mon/Wed/Fri 10am-4pm
const MWF_10_16 = buildHours([{ days: [1,3,5], open: "10:00", close: "16:00" }]);

// Evenings only (shelter check-in window)
const EVENINGS = buildHours([{ days: [0,1,2,3,4,5,6], open: "17:00", close: "23:00" }]);

// ---------------------------------------------------------------------------
// Organization definitions
// All lat/lng clustered ~SF for easy demo with a single search location.
// ---------------------------------------------------------------------------
const ORGS = [
  // ── FOOD ────────────────────────────────────────────────────────────────
  {
    org: {
      name: "Mission Street Food Bank",
      address: "1800 Mission St, San Francisco, CA 94103",
      latitude: 37.7645, longitude: -122.4190,
      phone: "415-555-0101", website: "https://example.org/msfb",
      verification_status: "VERIFIED",
      last_verified_at: "2025-03-01",
    },
    services: [{
      service_type: "food",
      eligibility_description: "Open to all SF residents. No income limit.",
      cost_indicator: "FREE",
      walk_in_indicator: 1, id_requirement_indicator: 0,
    }],
    hours: ALWAYS,
  },
  {
    org: {
      name: "Tenderloin Community Pantry",
      address: "230 Turk St, San Francisco, CA 94102",
      latitude: 37.7830, longitude: -122.4135,
      phone: "415-555-0102", website: null,
      verification_status: "VERIFIED",
      last_verified_at: "2025-02-15",
    },
    services: [{
      service_type: "food",
      eligibility_description: "Residents of Tenderloin neighborhood. Photo ID preferred but not required.",
      cost_indicator: "FREE",
      walk_in_indicator: 1, id_requirement_indicator: 0,
    }],
    hours: WEEKDAYS_SAT_9_17,
  },
  {
    org: {
      name: "Sunset Family Food Hub",
      address: "1420 Irving St, San Francisco, CA 94122",
      latitude: 37.7641, longitude: -122.4641,
      phone: "415-555-0103", website: "https://example.org/sffh",
      verification_status: "VERIFIED",
      last_verified_at: "2025-01-10",
    },
    services: [
      {
        service_type: "food",
        eligibility_description: "Families with children. Low-income households.",
        cost_indicator: "FREE",
        walk_in_indicator: 0, id_requirement_indicator: 1,
      },
    ],
    hours: MWF_10_16,
  },

  // ── SHELTER ─────────────────────────────────────────────────────────────
  {
    org: {
      name: "Civic Center Navigation Center",
      address: "101 Hyde St, San Francisco, CA 94102",
      latitude: 37.7803, longitude: -122.4161,
      phone: "415-555-0201", website: "https://example.org/ccnc",
      verification_status: "VERIFIED",
      last_verified_at: "2025-03-10",
    },
    services: [{
      service_type: "shelter",
      eligibility_description: "Adults experiencing homelessness. Referral from outreach worker preferred.",
      cost_indicator: "FREE",
      walk_in_indicator: 1, id_requirement_indicator: 0,
    }],
    hours: ALWAYS,
  },
  {
    org: {
      name: "South of Market Shelter",
      address: "1001 Howard St, San Francisco, CA 94103",
      latitude: 37.7750, longitude: -122.4065,
      phone: "415-555-0202", website: null,
      verification_status: "VERIFIED",
      last_verified_at: "2025-02-01",
    },
    services: [{
      service_type: "shelter",
      eligibility_description: "Single adults. Check-in from 5 PM nightly.",
      cost_indicator: "FREE",
      walk_in_indicator: 1, id_requirement_indicator: 0,
    }],
    hours: EVENINGS,
  },
  {
    org: {
      name: "Women's Safe Haven",
      address: "660 Brannan St, San Francisco, CA 94107",
      latitude: 37.7716, longitude: -122.3990,
      phone: "415-555-0203", website: "https://example.org/wsh",
      verification_status: "VERIFIED",
      last_verified_at: "2025-03-05",
    },
    services: [{
      service_type: "shelter",
      eligibility_description: "Women and non-binary adults 18+. No ID required for intake.",
      cost_indicator: "FREE",
      walk_in_indicator: 1, id_requirement_indicator: 0,
    }],
    hours: ALWAYS,
  },

  // ── MEDICAL ─────────────────────────────────────────────────────────────
  {
    org: {
      name: "Valencia Street Free Clinic",
      address: "1615 Valencia St, San Francisco, CA 94110",
      latitude: 37.7534, longitude: -122.4196,
      phone: "415-555-0301", website: "https://example.org/vsfc",
      verification_status: "VERIFIED",
      last_verified_at: "2025-02-20",
    },
    services: [{
      service_type: "medical",
      eligibility_description: "Uninsured and underinsured adults. Walk-ins seen on first-come basis.",
      cost_indicator: "FREE",
      walk_in_indicator: 1, id_requirement_indicator: 0,
    }],
    hours: WEEKDAYS_8_18,
  },
  {
    org: {
      name: "Haight Ashbury Health Center",
      address: "558 Clayton St, San Francisco, CA 94117",
      latitude: 37.7697, longitude: -122.4481,
      phone: "415-555-0302", website: "https://example.org/hahc",
      verification_status: "VERIFIED",
      last_verified_at: "2025-01-25",
    },
    services: [
      {
        service_type: "medical",
        eligibility_description: "All residents. Sliding scale fees. Medi-Cal accepted.",
        cost_indicator: "SLIDING_SCALE",
        walk_in_indicator: 0, id_requirement_indicator: 1,
      },
      {
        service_type: "mental_health",
        eligibility_description: "Individual counseling by appointment. Sliding scale.",
        cost_indicator: "SLIDING_SCALE",
        walk_in_indicator: 0, id_requirement_indicator: 0,
      },
    ],
    hours: WEEKDAYS_SAT_9_17,
  },
  {
    org: {
      name: "Richmond District Medical Aid",
      address: "3001 Geary Blvd, San Francisco, CA 94118",
      latitude: 37.7814, longitude: -122.4506,
      phone: "415-555-0303", website: null,
      verification_status: "PENDING",
      last_verified_at: "2024-12-01",
    },
    services: [{
      service_type: "medical",
      eligibility_description: "Low-income adults and seniors. Appointment required for primary care.",
      cost_indicator: "LOW_COST",
      walk_in_indicator: 0, id_requirement_indicator: 1,
    }],
    hours: WEEKDAYS_8_18,
  },

  // ── VACCINES ────────────────────────────────────────────────────────────
  {
    org: {
      name: "SF Community Vaccine Hub",
      address: "101 Grove St, San Francisco, CA 94102",
      latitude: 37.7793, longitude: -122.4183,
      phone: "415-555-0401", website: "https://example.org/sfvh",
      verification_status: "VERIFIED",
      last_verified_at: "2025-03-12",
    },
    services: [{
      service_type: "vaccines",
      eligibility_description: "All ages. Free flu, COVID, and childhood vaccines. No insurance required.",
      cost_indicator: "FREE",
      walk_in_indicator: 1, id_requirement_indicator: 0,
    }],
    hours: ALWAYS,
  },
  {
    org: {
      name: "Excelsior Wellness & Immunization",
      address: "4848 Mission St, San Francisco, CA 94112",
      latitude: 37.7218, longitude: -122.4376,
      phone: "415-555-0402", website: "https://example.org/ewi",
      verification_status: "VERIFIED",
      last_verified_at: "2025-02-28",
    },
    services: [
      {
        service_type: "vaccines",
        eligibility_description: "Children and adults. Travel vaccines available with appointment.",
        cost_indicator: "FREE",
        walk_in_indicator: 1, id_requirement_indicator: 0,
      },
      {
        service_type: "medical",
        eligibility_description: "General wellness check-ups. Sliding scale.",
        cost_indicator: "SLIDING_SCALE",
        walk_in_indicator: 0, id_requirement_indicator: 1,
      },
    ],
    hours: WEEKDAYS_SAT_9_17,
  },

  // ── MENTAL HEALTH ────────────────────────────────────────────────────────
  {
    org: {
      name: "Mission Mental Health Collective",
      address: "2340 Mission St, San Francisco, CA 94110",
      latitude: 37.7568, longitude: -122.4184,
      phone: "415-555-0501", website: "https://example.org/mmhc",
      verification_status: "VERIFIED",
      last_verified_at: "2025-03-08",
    },
    services: [{
      service_type: "mental_health",
      eligibility_description: "Adults 18+. Crisis counseling, therapy groups. Walk-in crisis hours.",
      cost_indicator: "FREE",
      walk_in_indicator: 1, id_requirement_indicator: 0,
    }],
    hours: ALWAYS,
  },
  {
    org: {
      name: "Bayview Counseling & Support",
      address: "1800 Oakdale Ave, San Francisco, CA 94124",
      latitude: 37.7325, longitude: -122.3893,
      phone: "415-555-0502", website: null,
      verification_status: "VERIFIED",
      last_verified_at: "2025-01-30",
    },
    services: [{
      service_type: "mental_health",
      eligibility_description: "Bayview/Hunters Point residents. Bilingual Spanish/English services.",
      cost_indicator: "FREE",
      walk_in_indicator: 0, id_requirement_indicator: 0,
    }],
    hours: MWF_10_16,
  },

  // ── LEGAL ────────────────────────────────────────────────────────────────
  {
    org: {
      name: "Tenderloin Legal Aid Center",
      address: "145 Taylor St, San Francisco, CA 94102",
      latitude: 37.7825, longitude: -122.4119,
      phone: "415-555-0601", website: "https://example.org/tlac",
      verification_status: "VERIFIED",
      last_verified_at: "2025-03-01",
    },
    services: [{
      service_type: "legal",
      eligibility_description: "Low-income individuals. Housing, immigration, benefits law. No ID required for intake.",
      cost_indicator: "FREE",
      walk_in_indicator: 1, id_requirement_indicator: 0,
    }],
    hours: WEEKDAYS_8_18,
  },
  {
    org: {
      name: "Bay Area Immigrant Legal Services",
      address: "995 Market St, San Francisco, CA 94103",
      latitude: 37.7814, longitude: -122.4097,
      phone: "415-555-0602", website: "https://example.org/bails",
      verification_status: "VERIFIED",
      last_verified_at: "2025-02-10",
    },
    services: [{
      service_type: "legal",
      eligibility_description: "Immigrants and asylum seekers. DACA renewals, family petitions.",
      cost_indicator: "FREE",
      walk_in_indicator: 0, id_requirement_indicator: 0,
    }],
    hours: WEEKDAYS_SAT_9_17,
  },

  // ── OTHER ─────────────────────────────────────────────────────────────────
  {
    org: {
      name: "SF Resource Connection Hub",
      address: "25 Van Ness Ave, San Francisco, CA 94102",
      latitude: 37.7748, longitude: -122.4200,
      phone: "415-555-0701", website: "https://example.org/sfrc",
      verification_status: "VERIFIED",
      last_verified_at: "2025-03-15",
    },
    services: [
      {
        service_type: "other",
        eligibility_description: "General navigation services — connects clients to housing, benefits, employment.",
        cost_indicator: "FREE",
        walk_in_indicator: 1, id_requirement_indicator: 0,
      },
    ],
    hours: ALWAYS,
  },
  {
    org: {
      name: "Potrero Hill Family Services",
      address: "1660 17th St, San Francisco, CA 94107",
      latitude: 37.7651, longitude: -122.4000,
      phone: "415-555-0702", website: null,
      verification_status: "VERIFIED",
      last_verified_at: "2025-01-20",
    },
    services: [
      {
        service_type: "food",
        eligibility_description: "Families with children under 18.",
        cost_indicator: "FREE",
        walk_in_indicator: 1, id_requirement_indicator: 0,
      },
      {
        service_type: "other",
        eligibility_description: "After-school programs and family counseling.",
        cost_indicator: "LOW_COST",
        walk_in_indicator: 0, id_requirement_indicator: 1,
      },
    ],
    hours: WEEKDAYS_8_18,
  },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
function seed() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");

  // -- Strategy A: wipe all dependent tables then reset sequences -----------
  console.log("🗑  Clearing existing demo data…");
  db.exec(`
    DELETE FROM reports;
    DELETE FROM services;
    DELETE FROM hours;
    DELETE FROM organizations;
    DELETE FROM sqlite_sequence WHERE name IN
      ('reports','services','hours','organizations');
  `);

  // -- Prepared statements --------------------------------------------------
  const insertOrg = db.prepare(`
    INSERT INTO organizations
      (name, address, latitude, longitude, phone, website,
       verification_status, last_verified_at)
    VALUES
      (@name, @address, @latitude, @longitude, @phone, @website,
       @verification_status, @last_verified_at)
  `);

  const insertService = db.prepare(`
    INSERT INTO services
      (organization_id, service_type, eligibility_description,
       cost_indicator, walk_in_indicator, id_requirement_indicator)
    VALUES
      (@organization_id, @service_type, @eligibility_description,
       @cost_indicator, @walk_in_indicator, @id_requirement_indicator)
  `);

  const insertHours = db.prepare(`
    INSERT INTO hours
      (organization_id, day_of_week, open_time, close_time, closed_indicator)
    VALUES
      (@organization_id, @day_of_week, @open_time, @close_time, @closed_indicator)
  `);

  // -- Insert inside a single transaction for speed -------------------------
  const run = db.transaction(() => {
    let orgCount = 0;
    let serviceCount = 0;
    let hoursCount = 0;

    for (const { org, services, hours } of ORGS) {
      const { lastInsertRowid: orgId } = insertOrg.run(org);
      orgCount++;

      for (const svc of services) {
        insertService.run({ organization_id: orgId, ...svc });
        serviceCount++;
      }

      for (const h of hours) {
        insertHours.run({ organization_id: orgId, ...h });
        hoursCount++;
      }
    }

    return { orgCount, serviceCount, hoursCount };
  });

  const { orgCount, serviceCount, hoursCount } = run();

  console.log(`✅ Seed complete:`);
  console.log(`   ${orgCount} organizations`);
  console.log(`   ${serviceCount} services`);
  console.log(`   ${hoursCount} hours rows`);
  console.log(`\n📍 Demo search location: lat=37.7749, lng=-122.4194 (SF)`);
  console.log(`   Try: curl "http://localhost:3001/api/organizations?lat=37.7749&lng=-122.4194&radiusMiles=10&openNow=true"`);

  db.close();
}

seed();
