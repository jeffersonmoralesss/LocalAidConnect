// FiltersBar.jsx
// Provides optional overrides for the AI-parsed query: openNow, radiusMiles, category.
// "null" value on any field means "defer to AI result — no override".
// REQ-3.2.3, REQ-3.2.4 (category filter, open-now filter)

import { ChevronIcon } from "./Icons";
import { useState } from "react";

export const CATEGORY_OPTIONS = [
  { value: "food",          label: "Food" },
  { value: "shelter",       label: "Shelter" },
  { value: "medical",       label: "Medical" },
  { value: "vaccines",      label: "Vaccines" },
  { value: "mental_health", label: "Mental Health" },
  { value: "legal",         label: "Legal" },
  { value: "other",         label: "Other" },
];

export const RADIUS_OPTIONS = [1, 3, 5, 10];

// Empty overrides — all fields null = "use AI result"
export const EMPTY_OVERRIDES = { openNow: null, radiusMiles: null, category: null };

/**
 * Returns true if any override is active (non-null).
 */
export function hasOverrides(overrides) {
  return Object.values(overrides).some((v) => v !== null);
}

/**
 * Merge AI-parsed query with user overrides to produce final search params.
 * parsedQuery may be null (before first search).
 */
export function applyOverrides(parsedQuery, overrides) {
  const base = parsedQuery ?? {};
  return {
    category:    overrides.category    !== null ? overrides.category    : (base.category    ?? ""),
    radiusMiles: overrides.radiusMiles !== null ? overrides.radiusMiles : (base.radiusMiles ?? 3),
    openNow:     overrides.openNow     !== null ? overrides.openNow     : (base.filters?.openNow ?? false),
  };
}

/**
 * FiltersBar
 * Props:
 *   overrides: { openNow: bool|null, radiusMiles: number|null, category: string|null }
 *   parsedQuery: object|null  — the AI-parsed query (for showing current AI suggestion as hint)
 *   onChange: (overrides) => void
 */
export default function FiltersBar({ overrides, parsedQuery, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const active = hasOverrides(overrides);

  const setField = (field, value) => {
    onChange({ ...overrides, [field]: value });
  };

  const clearAll = () => {
    onChange(EMPTY_OVERRIDES);
  };

  // Hints from AI parse — shown greyed in dropdowns as placeholder context
  const aiRadius   = parsedQuery?.radiusMiles ?? null;
  const aiCategory = parsedQuery?.category ?? null;
  const aiOpenNow  = parsedQuery?.filters?.openNow ?? null;

  return (
    <div className={`filters-bar${active ? " filters-bar--active" : ""}`}>
      {/* ── Toggle row ── */}
      <div className="filters-bar__toggle-row">
        <button
          className={`filters-toggle-btn${active ? " filters-toggle-btn--active" : ""}`}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="filters-panel"
          aria-label={`Filters${active ? " (overrides active)" : ""}`}
        >
          <span className="filters-toggle-btn__icon" aria-hidden="true">⊞</span>
          Filters
          {active && (
            <span className="filters-badge" aria-label="overrides active">
              {Object.values(overrides).filter((v) => v !== null).length}
            </span>
          )}
          <ChevronIcon direction={expanded ? "up" : "down"} size={13} />
        </button>

        {active && (
          <button className="filters-clear-btn" onClick={clearAll} aria-label="Clear all filter overrides">
            Clear
          </button>
        )}
      </div>

      {/* ── Expanded panel ── */}
      {expanded && (
        <div id="filters-panel" className="filters-panel" role="group" aria-label="Search filter overrides">

          {/* Open now */}
          <div className="filter-group">
            <span className="filter-group__label" id="filter-opennow-label">Open now</span>
            <div className="filter-toggle-group" role="radiogroup" aria-labelledby="filter-opennow-label">
              <button
                className={`filter-radio${overrides.openNow === null ? " filter-radio--selected" : ""}`}
                onClick={() => setField("openNow", null)}
                aria-pressed={overrides.openNow === null}
              >
                {aiOpenNow !== null ? (aiOpenNow ? "AI: yes" : "AI: no") : "Any"}
              </button>
              <button
                className={`filter-radio${overrides.openNow === true ? " filter-radio--selected" : ""}`}
                onClick={() => setField("openNow", true)}
                aria-pressed={overrides.openNow === true}
              >
                Yes
              </button>
              <button
                className={`filter-radio${overrides.openNow === false ? " filter-radio--selected" : ""}`}
                onClick={() => setField("openNow", false)}
                aria-pressed={overrides.openNow === false}
              >
                No
              </button>
            </div>
          </div>

          {/* Radius */}
          <div className="filter-group">
            <label className="filter-group__label" htmlFor="filter-radius">Radius</label>
            <select
              id="filter-radius"
              className="filter-select"
              value={overrides.radiusMiles ?? ""}
              onChange={(e) =>
                setField("radiusMiles", e.target.value === "" ? null : Number(e.target.value))
              }
            >
              <option value="">
                {aiRadius !== null ? `AI: ${aiRadius} mi` : "Any"}
              </option>
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>{r} mi</option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div className="filter-group">
            <label className="filter-group__label" htmlFor="filter-category">Category</label>
            <select
              id="filter-category"
              className="filter-select"
              value={overrides.category ?? ""}
              onChange={(e) =>
                setField("category", e.target.value === "" ? null : e.target.value)
              }
            >
              <option value="">
                {aiCategory ? `AI: ${aiCategory.replace(/_/g, " ")}` : "Any"}
              </option>
              {CATEGORY_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
