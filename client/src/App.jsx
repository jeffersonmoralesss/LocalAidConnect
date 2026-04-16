import { useState, useCallback, useRef } from "react";
import "./App.css";
import FiltersBar, { EMPTY_OVERRIDES, applyOverrides, hasOverrides } from "./components/FiltersBar";
import OrgDetailModal from "./components/OrgDetailModal";
import { SearchIcon, LocateIcon, PhoneIcon, DirectionsIcon, WebIcon } from "./components/Icons";

// ── Constants ────────────────────────────────────────────────
const DEMO_LOCATION = { lat: 37.7749, lng: -122.4194, label: "San Francisco, CA" };

const PLACEHOLDER_QUERIES = [
  "I need free food near me, open now",
  "looking for a shelter that takes walk-ins tonight",
  "free clinic within 5 miles, no ID needed",
  "mental health counseling this week",
  "legal aid, low cost",
];

// ── Helpers ──────────────────────────────────────────────────
function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by your browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("Location access was denied."))
    );
  });
}

function tzOffset() {
  return -new Date().getTimezoneOffset();
}

function formatCost(indicator) {
  if (!indicator) return null;
  const map = { FREE: "Free", LOW_COST: "Low cost", SLIDING_SCALE: "Sliding scale", PAID: "Paid" };
  return map[indicator] ?? indicator;
}

function formatServiceType(type) {
  if (!type) return type;
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Small display components ─────────────────────────────────

function OpenBadge({ status }) {
  if (status === true)  return <span className="badge badge--open">Open now</span>;
  if (status === false) return <span className="badge badge--closed">Closed</span>;
  return <span className="badge badge--unknown">Hours unknown</span>;
}

function ServiceTag({ service }) {
  const parts = [formatServiceType(service.serviceType)];
  const cost = formatCost(service.costIndicator);
  if (cost && cost !== "Paid") parts.push(cost);
  if (service.walkInIndicator)         parts.push("Walk-in");
  if (!service.idRequirementIndicator) parts.push("No ID");
  return (
    <span className="service-tag" title={service.eligibilityDescription || undefined}>
      {parts.join(" · ")}
    </span>
  );
}

// ── OrgCard ──────────────────────────────────────────────────

function OrgCard({ org, onSelect }) {
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(org.address)}`;
  return (
    <article className="org-card">
      {/* Clickable region opens detail modal */}
      <button
        className="org-card__click-target"
        onClick={() => onSelect(org)}
        aria-label={`View details for ${org.name}`}
      >
        <header className="org-card__header">
          <div className="org-card__title-row">
            <h2 className="org-card__name">{org.name}</h2>
            <OpenBadge status={org.openNowStatus} />
          </div>
          <p className="org-card__distance">
            {org.distanceMiles != null ? `${org.distanceMiles} mi away` : ""}
            {org.verification_status === "VERIFIED" && (
              <span className="verified-chip" title="Verified organization">✓ Verified</span>
            )}
          </p>
        </header>
        <div className="org-card__body">
          <p className="org-card__address">{org.address}</p>
          {org.services && org.services.length > 0 && (
            <div className="org-card__services">
              {org.services.map((s) => <ServiceTag key={s.id} service={s} />)}
            </div>
          )}
        </div>
      </button>

      {/* Quick-action row — outside the card button to avoid nested interactive elements */}
      <footer className="org-card__actions">
        <a href={`tel:${org.phone}`} className="action-btn action-btn--call"
          aria-label={`Call ${org.name}`}>
          <PhoneIcon /> Call
        </a>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
          className="action-btn action-btn--dir"
          aria-label={`Directions to ${org.name}`}>
          <DirectionsIcon /> Directions
        </a>
        {org.website && (
          <a href={org.website} target="_blank" rel="noopener noreferrer"
            className="action-btn action-btn--web"
            aria-label={`${org.name} website`}>
            <WebIcon /> Website
          </a>
        )}
        <button className="action-btn action-btn--detail" onClick={() => onSelect(org)}
          aria-label={`Full details for ${org.name}`}>
          Details →
        </button>
      </footer>

      <p className="org-card__verified-date">
        Last verified: {org.last_verified_at ? org.last_verified_at.slice(0, 10) : "unknown"}
      </p>
    </article>
  );
}

// ── Query summary ─────────────────────────────────────────────

function QuerySummary({ parsedQuery, source, overrides, finalParams }) {
  if (!parsedQuery || !finalParams) return null;
  const urgencyLabel = { now: "Urgent", today: "Today", this_week: "This week" };
  const aiFilters = parsedQuery.filters ?? {};
  const overrideCount = Object.values(overrides).filter((v) => v !== null).length;

  return (
    <div className="query-summary" role="status" aria-live="polite">
      <span className="query-summary__source">{source === "ai" ? "AI" : "Keyword"} search</span>
      <span className="query-pill query-pill--cat">
        {formatServiceType(finalParams.category || parsedQuery.category)}
      </span>
      <span className="query-pill query-pill--urgency">
        {urgencyLabel[parsedQuery.urgency] ?? parsedQuery.urgency}
      </span>
      <span className={`query-pill${overrides.radiusMiles !== null ? " query-pill--override" : ""}`}>
        {finalParams.radiusMiles} mi{overrides.radiusMiles !== null && " ↑"}
      </span>
      {finalParams.openNow && (
        <span className={`query-pill query-pill--filter${overrides.openNow !== null ? " query-pill--override" : ""}`}>
          Open now{overrides.openNow !== null && " ↑"}
        </span>
      )}
      {aiFilters.walkIn   && <span className="query-pill query-pill--filter">Walk-in</span>}
      {aiFilters.costFree && <span className="query-pill query-pill--filter">Free/low-cost</span>}
      {aiFilters.noId     && <span className="query-pill query-pill--filter">No ID</span>}
      {overrideCount > 0 && (
        <span className="query-pill query-pill--override-note"
          aria-label={`${overrideCount} filter override${overrideCount > 1 ? "s" : ""} applied`}>
          {overrideCount} override{overrideCount > 1 ? "s" : ""} applied
        </span>
      )}
    </div>
  );
}

// ── Location bar ──────────────────────────────────────────────

function LocationBar({ coords, locating, onUseBrowser, onUseDemo, onManualChange }) {
  const [showManual, setShowManual] = useState(false);
  const [latInput, setLatInput]     = useState("");
  const [lngInput, setLngInput]     = useState("");

  const applyManual = () => {
    const lat = parseFloat(latInput);
    const lng = parseFloat(lngInput);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    onManualChange({ lat, lng });
    setShowManual(false);
  };

  const coordLabel = !coords
    ? "No location set"
    : coords.isDemo
      ? `${DEMO_LOCATION.label} (demo)`
      : `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;

  return (
    <div className="location-bar" aria-label="Location settings">
      <span className="location-bar__label">
        <LocateIcon />
        <span className={`location-bar__coords${!coords ? " location-bar__coords--unset" : ""}`}>
          {coordLabel}
        </span>
      </span>
      <div className="location-bar__actions">
        <button className="loc-btn" onClick={onUseBrowser} disabled={locating}
          aria-label="Use my browser location">
          {locating
            ? <><span className="spinner spinner--sm" aria-hidden="true" /> Locating…</>
            : <><LocateIcon /> My location</>}
        </button>
        <button className="loc-btn loc-btn--demo" onClick={onUseDemo}
          title="Sets location to SF to match seeded demo data"
          aria-label="Use San Francisco demo location">
          SF demo
        </button>
        <button className="loc-btn" onClick={() => setShowManual((v) => !v)}
          aria-expanded={showManual} aria-label="Enter coordinates manually">
          Manual
        </button>
      </div>
      {showManual && (
        <div className="manual-coords" role="group" aria-label="Manual coordinate entry">
          <label className="manual-coords__label" htmlFor="lat-input">Lat</label>
          <input id="lat-input" className="manual-coords__input" type="number" step="any"
            placeholder="37.7749" value={latInput}
            onChange={(e) => setLatInput(e.target.value)} aria-label="Latitude" />
          <label className="manual-coords__label" htmlFor="lng-input">Lng</label>
          <input id="lng-input" className="manual-coords__input" type="number" step="any"
            placeholder="-122.4194" value={lngInput}
            onChange={(e) => setLngInput(e.target.value)} aria-label="Longitude" />
          <button className="loc-btn loc-btn--apply" onClick={applyManual}>Apply</button>
        </div>
      )}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [text, setText]               = useState("");
  const [results, setResults]         = useState(null);
  const [parsedQuery, setParsedQuery] = useState(null);
  const [source, setSource]           = useState(null);
  const [finalParams, setFinalParams] = useState(null);
  const [overrides, setOverrides]     = useState(EMPTY_OVERRIDES);
  const [loading, setLoading]         = useState(false);
  const [locating, setLocating]       = useState(false);
  const [error, setError]             = useState(null);
  const [coords, setCoords]           = useState(null);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const inputRef = useRef(null);

  // ── Location ───────────────────────────────────────────────
  const handleUseBrowser = useCallback(async () => {
    setError(null);
    setLocating(true);
    try {
      const c = await getBrowserLocation();
      setCoords({ ...c, isDemo: false });
    } catch (e) {
      setError(e.message);
    } finally {
      setLocating(false);
    }
  }, []);

  const handleUseDemo    = useCallback(() => {
    setCoords({ lat: DEMO_LOCATION.lat, lng: DEMO_LOCATION.lng, isDemo: true });
    setError(null);
  }, []);

  const handleManualChange = useCallback((c) => {
    setCoords({ ...c, isDemo: false });
    setError(null);
  }, []);

  // ── Search (2-step: parse → organizations) ─────────────────
  const runSearch = useCallback(async (queryText, activeOverrides) => {
    const q = (queryText ?? text).trim();
    if (!q) { inputRef.current?.focus(); return; }

    let c = coords;
    if (!c) {
      c = { lat: DEMO_LOCATION.lat, lng: DEMO_LOCATION.lng, isDemo: true };
      setCoords(c);
    }

    const ov = activeOverrides ?? overrides;
    setError(null);
    setLoading(true);

    try {
      // Step 1 — parse natural language (REQ-3.1.1–3.1.6)
      const parseRes = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!parseRes.ok) {
        const body = await parseRes.json().catch(() => ({}));
        throw new Error(body.error ?? `Parse error ${parseRes.status}`);
      }
      const { query: pq, source: src } = await parseRes.json();
      setParsedQuery(pq);
      setSource(src);

      // Step 2 — merge user overrides on top of AI result
      const merged = applyOverrides(pq, ov);
      setFinalParams(merged);

      // Step 3 — fetch organizations (REQ-3.2.1–3.2.4)
      const params = new URLSearchParams({
        lat:             c.lat,
        lng:             c.lng,
        radiusMiles:     merged.radiusMiles,
        tzOffsetMinutes: tzOffset(),
      });
      if (merged.category) params.set("category", merged.category);
      if (merged.openNow)  params.set("openNow", "true");

      const orgRes = await fetch(`/api/organizations?${params}`);
      if (!orgRes.ok) {
        const body = await orgRes.json().catch(() => ({}));
        throw new Error(body.error ?? `Search error ${orgRes.status}`);
      }
      const data = await orgRes.json();
      setResults(data.results ?? []);
    } catch (e) {
      setError(e.message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [text, coords, overrides]);

  // Re-run when overrides change if results are already shown
  const handleOverrideChange = useCallback((newOverrides) => {
    setOverrides(newOverrides);
    if (results !== null && text.trim()) {
      runSearch(text, newOverrides);
    }
  }, [results, text, runSearch]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__inner">
          <div className="logo">
            <span className="logo__mark" aria-hidden="true">◈</span>
            <span className="logo__text">LocalAid<em>Connect</em></span>
          </div>
          <p className="app-header__tagline">Find nearby services — food, shelter, clinics &amp; more</p>
        </div>
      </header>

      <main className="app-main">
        <section className="search-section" aria-label="Search for local aid">
          <div className="search-box" role="search">
            <label htmlFor="search-input" className="sr-only">Describe what you need</label>
            <div className="search-input-wrap">
              <span className="search-input-wrap__icon" aria-hidden="true"><SearchIcon /></span>
              <input
                id="search-input"
                ref={inputRef}
                type="text"
                className="search-input"
                placeholder="Describe what you need…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                autoComplete="off"
                spellCheck={false}
                aria-label="Describe what you need"
              />
            </div>
            <button className="search-btn" onClick={() => runSearch()}
              disabled={loading || locating} aria-busy={loading}>
              {loading ? <span className="spinner" aria-hidden="true" /> : <SearchIcon />}
              {loading ? "Searching…" : "Find help"}
            </button>
          </div>

          {results === null && !loading && (
            <div className="suggestions" aria-label="Example searches">
              {PLACEHOLDER_QUERIES.map((s) => (
                <button key={s} className="suggestion-chip"
                  onClick={() => { setText(s); runSearch(s, overrides); }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </section>

        <LocationBar
          coords={coords} locating={locating}
          onUseBrowser={handleUseBrowser}
          onUseDemo={handleUseDemo}
          onManualChange={handleManualChange}
        />

        <FiltersBar
          overrides={overrides}
          parsedQuery={parsedQuery}
          onChange={handleOverrideChange}
        />

        {error && (
          <div className="alert alert--error" role="alert">
            <strong>Error:</strong> {error}
          </div>
        )}

        {parsedQuery && !loading && finalParams && (
          <QuerySummary
            parsedQuery={parsedQuery} source={source}
            overrides={overrides} finalParams={finalParams}
          />
        )}

        {results !== null && !loading && (
          <section className="results-section" aria-label="Search results" aria-live="polite">
            {results.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state__icon" aria-hidden="true">🔍</p>
                <h3>No results found</h3>
                <p>Try expanding your search radius or changing your search terms.</p>
                {hasOverrides(overrides) && (
                  <p className="empty-state__hint">You have active filter overrides — try clearing them.</p>
                )}
              </div>
            ) : (
              <>
                <h2 className="results-heading">
                  {results.length} result{results.length !== 1 ? "s" : ""} found
                </h2>
                <ul className="results-list" aria-label={`${results.length} organizations found`}>
                  {results.map((org) => (
                    <li key={org.id}>
                      <OrgCard org={org} onSelect={setSelectedOrg} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>
          Results may not reflect real-time availability.
          Always call ahead to confirm services.{" "}
          <strong>In an emergency, call 911.</strong>
        </p>
      </footer>

      {selectedOrg && (
        <OrgDetailModal
          org={selectedOrg}
          onClose={() => setSelectedOrg(null)}
        />
      )}
    </div>
  );
}
