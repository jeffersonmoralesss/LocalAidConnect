// AI Parse API route
// Implements REQ-3.1.1 through REQ-3.1.6: AI-guided natural language search

const { DEFAULT_RADIUS_MILES } = require("../constants");

/**
 * Valid JSON schema for AI output (REQ-3.1.2, REQ-3.1.6)
 * From SRS Section 3.1 AI Output Schema
 */
const VALID_CATEGORIES = [
  "food",
  "shelter",
  "medical",
  "vaccines",
  "mental_health",
  "legal",
  "other",
];
const VALID_URGENCY = ["now", "today", "this_week"];

/**
 * Validate AI output against strict JSON schema (REQ-3.1.6)
 * Returns { valid: boolean, errors: string[] }
 */
function validateQuerySchema(query) {
  const errors = [];

  if (!query || typeof query !== "object") {
    return { valid: false, errors: ["Query must be an object"] };
  }

  // Validate category
  if (!query.category || !VALID_CATEGORIES.includes(query.category)) {
    errors.push(
      `category must be one of: ${VALID_CATEGORIES.join(", ")}`
    );
  }

  // Validate urgency
  if (!query.urgency || !VALID_URGENCY.includes(query.urgency)) {
    errors.push(`urgency must be one of: ${VALID_URGENCY.join(", ")}`);
  }

  // Validate radiusMiles
  if (
    typeof query.radiusMiles !== "number" ||
    query.radiusMiles <= 0 ||
    query.radiusMiles > 100
  ) {
    errors.push("radiusMiles must be a number between 0 and 100");
  }

  // Validate filters object
  if (!query.filters || typeof query.filters !== "object") {
    errors.push("filters must be an object");
  } else {
    const filters = query.filters;
    if (typeof filters.openNow !== "boolean") {
      errors.push("filters.openNow must be a boolean");
    }
    if (typeof filters.walkIn !== "boolean") {
      errors.push("filters.walkIn must be a boolean");
    }
    if (typeof filters.costFree !== "boolean") {
      errors.push("filters.costFree must be a boolean");
    }
    if (typeof filters.noId !== "boolean") {
      errors.push("filters.noId must be a boolean");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Extract keywords from natural language for fallback search (REQ-3.1.5)
 * Simple keyword extraction - looks for category keywords and urgency indicators
 */
function extractKeywords(text) {
  const lowerText = text.toLowerCase();

  // Extract category keywords
  const categoryKeywords = {
    food: ["food", "hungry", "meal", "groceries", "pantry"],
    shelter: ["shelter", "housing", "homeless", "bed", "sleep"],
    medical: ["medical", "doctor", "clinic", "health", "sick"],
    vaccines: ["vaccine", "vaccination", "immunization", "shot"],
    mental_health: [
      "mental health",
      "counseling",
      "therapy",
      "psychologist",
      "depression",
    ],
    legal: ["legal", "lawyer", "attorney", "court", "law"],
  };

  let category = "other";
  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((kw) => lowerText.includes(kw))) {
      category = cat;
      break;
    }
  }

  // Extract urgency
  let urgency = "this_week";
  if (lowerText.includes("now") || lowerText.includes("immediately")) {
    urgency = "now";
  } else if (
    lowerText.includes("today") ||
    lowerText.includes("asap") ||
    lowerText.includes("urgent")
  ) {
    urgency = "today";
  }

  // Extract radius hints (very basic)
  // Use canonical default from constants (REQ-3.1.x schema example)
  let radiusMiles = DEFAULT_RADIUS_MILES;
  const radiusMatch = lowerText.match(/(\d+)\s*(mile|mi|miles)/);
  if (radiusMatch) {
    radiusMiles = Math.min(parseInt(radiusMatch[1], 10), 50);
  }

  // Extract filter hints
  const filters = {
    openNow:
      lowerText.includes("open now") ||
      lowerText.includes("open today") ||
      lowerText.includes("currently open"),
    walkIn:
      lowerText.includes("walk in") ||
      lowerText.includes("walk-in") ||
      lowerText.includes("walkin") ||
      lowerText.includes("no appointment"),
    costFree:
      lowerText.includes("free") ||
      lowerText.includes("no cost") ||
      lowerText.includes("no charge") ||
      lowerText.includes("low cost") ||
      lowerText.includes("affordable"),
    noId:
      lowerText.includes("no id") ||
      lowerText.includes("no identification") ||
      lowerText.includes("without id") ||
      lowerText.includes("don't need id"),
  };

  return {
    category,
    urgency,
    radiusMiles,
    filters,
  };
}

/**
 * Call LLM to parse natural language into structured query (REQ-3.1.2)
 * Returns parsed query or null if parsing fails
 */
async function parseWithAI(userInput) {
  // REQ-3.1.3: AI must NOT invent organizations or claim real-time availability
  // REQ-3.1.4: AI must NOT provide medical, legal, or emergency advice
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
- category: infer from user's need (food, shelter, medical, vaccines, mental_health, legal, or other)
- urgency: "now" for immediate need, "today" for today, "this_week" for this week
- radiusMiles: default to ${DEFAULT_RADIUS_MILES}, increase if user mentions distance (max 50)
- filters.openNow: true if user wants places open right now
- filters.walkIn: true if user needs walk-in (no appointment)
- filters.costFree: true if user needs free/low-cost services
- filters.noId: true if user needs places that don't require ID

Output ONLY the JSON object, no other text.`;

  const userPrompt = `Parse this user request into the JSON schema:\n\n"${userInput}"`;

  // Check if OpenAI API key is configured
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // In development, return null to trigger fallback
    // eslint-disable-next-line no-console
    console.warn(
      "OPENAI_API_KEY not set, AI parsing disabled (will use keyword fallback)"
    );
    return null;
  }

  try {
    // Dynamic import to avoid requiring openai package if not installed
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1, // Low temperature for consistent, structured output
      max_tokens: 200,
      response_format: { type: "json_object" }, // Force JSON output
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return null;
    }

    // Parse JSON response
    const parsed = JSON.parse(content);
    return parsed;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("AI parsing error:", error.message);
    return null;
  }
}

/**
 * POST /api/ai/parse
 * Body: { query: string }
 *
 * REQ-3.1.1: accepts natural language input
 * REQ-3.1.2: outputs strict JSON schema
 * REQ-3.1.3: does not invent organizations or claim availability
 * REQ-3.1.4: does not provide medical/legal/emergency advice
 * REQ-3.1.5: falls back to keyword search if parsing fails
 * REQ-3.1.6: validates all outputs server-side
 */
async function parseQuery(req, res) {
  const { query } = req.body;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return res.status(400).json({
      error: "query field is required and must be a non-empty string",
      fallback: null,
    });
  }

  // Try AI parsing first
  let parsedQuery = await parseWithAI(query.trim());
  let source = "keyword"; // Default to keyword fallback

  // Validate AI output (REQ-3.1.6)
  if (parsedQuery) {
    const validation = validateQuerySchema(parsedQuery);
    if (!validation.valid) {
      // eslint-disable-next-line no-console
      console.warn(
        "AI output failed validation:",
        validation.errors,
        "Falling back to keyword extraction"
      );
      parsedQuery = null; // Trigger fallback
    } else {
      source = "ai"; // AI parsing succeeded and passed validation
    }
  }

  // REQ-3.1.5: Fall back to keyword-based search if AI parsing fails
  if (!parsedQuery) {
    parsedQuery = extractKeywords(query.trim());
    // eslint-disable-next-line no-console
    console.log("Using keyword fallback for query:", query);
  }

  // Final validation (should always pass for keyword extraction, but double-check)
  const finalValidation = validateQuerySchema(parsedQuery);
  if (!finalValidation.valid) {
    // This should never happen with keyword extraction, but handle gracefully
    return res.status(500).json({
      error: "Failed to parse query",
      details: finalValidation.errors,
    });
  }

  res.json({
    query: parsedQuery,
    source,
  });
}

module.exports = { parseQuery };
