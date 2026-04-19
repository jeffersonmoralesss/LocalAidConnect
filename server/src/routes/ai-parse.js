// AI Parse API route
// Implements REQ-3.1.1 through REQ-3.1.6: AI-guided natural language search.
//
// Exports both the HTTP handler (parseQuery) and a reusable core function
// (parseTextToQuery) so other routes — like POST /api/search — can share the
// same parse + validate + fallback pipeline.

const { DEFAULT_RADIUS_MILES } = require("../constants");

// ─── Schema ────────────────────────────────────────────────────────────────
const VALID_CATEGORIES = [
  "food", "shelter", "medical", "vaccines",
  "mental_health", "legal", "other",
];
const VALID_URGENCY = ["now", "today", "this_week"];

function validateQuerySchema(query) {
  const errors = [];

  if (!query || typeof query !== "object") {
    return { valid: false, errors: ["Query must be an object"] };
  }
  if (!query.category || !VALID_CATEGORIES.includes(query.category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }
  if (!query.urgency || !VALID_URGENCY.includes(query.urgency)) {
    errors.push(`urgency must be one of: ${VALID_URGENCY.join(", ")}`);
  }
  if (typeof query.radiusMiles !== "number" || query.radiusMiles <= 0 || query.radiusMiles > 100) {
    errors.push("radiusMiles must be a number between 0 and 100");
  }
  if (!query.filters || typeof query.filters !== "object") {
    errors.push("filters must be an object");
  } else {
    for (const key of ["openNow", "walkIn", "costFree", "noId"]) {
      if (typeof query.filters[key] !== "boolean") {
        errors.push(`filters.${key} must be a boolean`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Keyword fallback extractor ────────────────────────────────────────────
function extractKeywords(text) {
  const lowerText = text.toLowerCase();

  const categoryKeywords = {
    food: ["food", "hungry", "meal", "groceries", "pantry"],
    shelter: ["shelter", "housing", "homeless", "bed", "sleep"],
    medical: ["medical", "doctor", "clinic", "health", "sick"],
    vaccines: ["vaccine", "vaccination", "immunization", "shot"],
    mental_health: ["mental health", "counseling", "therapy", "psychologist", "depression"],
    legal: ["legal", "lawyer", "attorney", "court", "law"],
  };

  let category = "other";
  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((kw) => lowerText.includes(kw))) { category = cat; break; }
  }

  let urgency = "this_week";
  if (lowerText.includes("now") || lowerText.includes("immediately")) urgency = "now";
  else if (lowerText.includes("today") || lowerText.includes("asap") || lowerText.includes("urgent")) urgency = "today";

  let radiusMiles = DEFAULT_RADIUS_MILES;
  const radiusMatch = lowerText.match(/(\d+)\s*(mile|mi|miles)/);
  if (radiusMatch) radiusMiles = Math.min(parseInt(radiusMatch[1], 10), 50);

  const filters = {
    openNow:
      lowerText.includes("open now") || lowerText.includes("open today") || lowerText.includes("currently open"),
    walkIn:
      lowerText.includes("walk in") || lowerText.includes("walk-in") ||
      lowerText.includes("walkin") || lowerText.includes("no appointment"),
    costFree:
      lowerText.includes("free") || lowerText.includes("no cost") ||
      lowerText.includes("no charge") || lowerText.includes("low cost") ||
      lowerText.includes("affordable"),
    noId:
      lowerText.includes("no id") || lowerText.includes("no identification") ||
      lowerText.includes("without id") || lowerText.includes("don't need id"),
  };

  return { category, urgency, radiusMiles, filters };
}

// ─── LLM call ──────────────────────────────────────────────────────────────
async function parseWithAI(userInput) {
  const systemPrompt = `You are a query parser for a local aid organization search system. Your ONLY job is to convert natural language user requests into a strict JSON query format.

CRITICAL CONSTRAINTS:
- You MUST NOT invent or mention any specific organizations
- You MUST NOT claim any organization has real-time availability (beds, appointments, etc.)
- You MUST NOT provide medical, legal, or emergency advice
- You MUST ONLY output valid JSON matching the exact schema below

Output ONLY valid JSON matching this schema:
{
  "category": "food | shelter | medical | vaccines | mental_health | legal | other",
  "urgency": "now | today | this_week",
  "radiusMiles": <number between 1 and 50>,
  "filters": {
    "openNow": <boolean>,
    "walkIn": <boolean>,
    "costFree": <boolean>,
    "noId": <boolean>
  }
}

Rules:
- category: infer from user's need
- urgency: "now" for immediate need, "today" for today, "this_week" for this week
- radiusMiles: default to ${DEFAULT_RADIUS_MILES}, increase if user mentions distance (max 50)
- filters.openNow: true if user wants places open right now
- filters.walkIn: true if user needs walk-in (no appointment)
- filters.costFree: true if user needs free/low-cost services
- filters.noId: true if user needs places that don't require ID

Output ONLY the JSON object, no other text.`;

  const userPrompt = `Parse this user request into the JSON schema:\n\n"${userInput}"`;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn("OPENAI_API_KEY not set, AI parsing disabled (will use keyword fallback)");
    return null;
  }

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("AI parsing error:", error.message);
    return null;
  }
}

// ─── Core: text → validated query (reusable) ───────────────────────────────
/**
 * Parse a natural-language search string into a validated structured query.
 * Falls back to keyword extraction on any parsing/validation failure.
 *
 * @param {string} text
 * @returns {Promise<{ query: object, source: "ai" | "keyword" }>}
 */
async function parseTextToQuery(text) {
  let parsed = await parseWithAI(text);
  let source = "keyword";

  if (parsed) {
    const v = validateQuerySchema(parsed);
    if (!v.valid) {
      // eslint-disable-next-line no-console
      console.warn("AI output failed validation:", v.errors, "— falling back to keywords");
      parsed = null;
    } else {
      source = "ai";
    }
  }

  if (!parsed) {
    parsed = extractKeywords(text);
    // eslint-disable-next-line no-console
    console.log("Using keyword fallback for query:", text);
  }

  // Final guard — keyword extractor should always produce valid output,
  // but if it somehow doesn't, surface the error rather than silently failing.
  const final = validateQuerySchema(parsed);
  if (!final.valid) {
    throw new Error(`Parsed query failed validation: ${final.errors.join(", ")}`);
  }

  return { query: parsed, source };
}

// ─── HTTP handler for POST /api/ai/parse ───────────────────────────────────
async function parseQuery(req, res) {
  const { query } = req.body;
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({
      error: "query field is required and must be a non-empty string",
      fallback: null,
    });
  }

  try {
    const result = await parseTextToQuery(query.trim());
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "Failed to parse query", details: e.message });
  }
}

module.exports = { parseQuery, parseTextToQuery };
