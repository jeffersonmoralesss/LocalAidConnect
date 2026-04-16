import { useState, useCallback, useRef } from "react";
import "./App.css";

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

function tzOffsetMinutes() {
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

// ── Small components ─────────────────────────────────────────
function OpenBadge({ status }) {
  if (status === true)  return <span className="badge badge--open">Open now</span>;
  if (status === false) return <span className="badge badge--closed">Closed</span>;
  return <span className="badge badge--unknown">Hours unknown</span>;
}

function ServiceTag({ service }) {
  const parts = [formatServiceType(service.serviceType)];
  const cost = formatCost(service.costIndicator);
  if (cost && cost !== "Paid") parts.push(cost);
  if (service.walkInIndicator) parts.push("Walk-in");
  if (!service.idRequirementIndicator) parts.push("No ID");
  return (
    <span className="service-tag" title={service.eligibilityDescription || undefined}>
      {parts.join(" · ")}
    </span>
  );
}

function OrgCard({ org }) {
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(org.address)}`;
  return (
    <article className="org-card">
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

      <footer className="org-card__actions">
        <a href={`tel:${org.phone}`} className="action-btn action-btn--call">
          <PhoneIcon /> Call
        </a>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="action-btn action-btn--dir">
          <DirectionsIcon /> Directions
        </a>
        {org.website && (
          <a href={org.website} target="_blank" rel="noopener noreferrer" className="action-btn action-btn--web">
            <WebIcon /> Website
          </a>
        )}
      </footer>

      <p className="org-card__verified-date">
        Last verified: {org.last_verified_at ? org.last_verified_at.slice(0, 10) : "unknown"}
      </p>
    </article>
  );
}

function QuerySummary({ query, source }) {
  if (!query) return null;
  const urgencyLabel = { now: "Urgent", today: "Today", this_week: "This week" };
  const filters = [];
  if (query.filters?.openNow)  filters.push("Open now");
  if (query.filters?.walkIn)   filters.push("Walk-in");
  if (query.filters?.costFree) filters.push("Free/low-cost");
  if (query.filters?.noId)     filters.push("No ID");

  return (
    <div className="query-summary" role="status" aria-live="polite">
      <span className="query-summary__source">{source === "ai" ? "AI" : "Keyword"} search</span>
      <span className="query-pill query-pill--cat">{formatServiceType(query.category)}</span>
      <span className="query-pill query-pill--urgency">{urgencyLabel[query.urgency] ?? query.urgency}</span>
      <span className="query-pill">{query.radiusMiles} mi</span>
      {filters.map((f) => <span key={f} className="query-pill query-pill--filter">{f}</span>)}
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

  const coordLabel = coords
    ? coords.isDemo
      ? `${DEMO_LOCATION.label} (demo)`
      : `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
    : "No location set";

  return (
    <div className="location-bar" aria-label="Location settings">
      <span className="location-bar__label">
        <LocateIcon />
        <span className={`location-bar__coords${!coords ? " location-bar__coords--unset" : ""}`}>
          {coordLabel}
        </span>
      </span>

      <div className="location-bar__actions">
        <button
          className="loc-btn"
          onClick={onUseBrowser}
          disabled={locating}
          aria-label="Use my browser location"
        >
          {locating
            ? <><span className="spinner spinner--sm" aria-hidden="true" /> Locating…</>
            : <><LocateIcon /> My location</>
          }
        </button>

        <button
          className="loc-btn loc-btn--demo"
          onClick={onUseDemo}
          aria-label="Use San Francisco demo location"
          title="Sets location to SF to match seeded demo data"
        >
          SF demo
        </button>

        <button
          className="loc-btn"
          onClick={() => setShowManual((v) => !v)}
          aria-expanded={showManual}
          aria-label="Enter coordinates manually"
        >
          Manual
        </button>
      </div>

      {showManual && (
        <div className="manual-coords" role="group" aria-label="Manual coordinate entry">
          <label className="manual-coords__label" htmlFor="lat-input">Lat</label>
          <input
            id="lat-input"
            className="manual-coords__input"
            type="number"
            step="any"
            placeholder="37.7749"
            value={latInput}
            onChange={(e) => setLatInput(e.target.value)}
            aria-label="Latitude"
          />
          <label className="manual-coords__label" htmlFor="lng-input">Lng</label>
          <input
            id="lng-input"
            className="manual-coords__input"
            type="number"
            step="any"
            placeholder="-122.4194"
            value={lngInput}
            onChange={(e) => setLngInput(e.target.value)}
            aria-label="Longitude"
          />
          <button className="loc-btn loc-btn--apply" onClick={applyManual}>
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

// ── SVG icons ─────────────────────────────────────────────────
const PhoneIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.6 19.79 19.79 0 0 1 1.61 5a2 2 0 0 1 1.99-2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 10.9a16 16 0 0 0 6 6l.82-.97a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 18.18z"/>
  </svg>
);
const DirectionsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="3 11 22 2 13 21 11 13 3 11"/>
  </svg>
);
const WebIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);
const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const LocateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
  </svg>
);

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [text, setText]               = useState("");
  const [results, setResults]         = useState(null);
  const [parsedQuery, setParsedQuery] = useState(null);
  const [source, setSource]           = useState(null);
  const [loading, setLoading]         = useState(false);
  const [locating, setLocating]       = useState(false);
  const [error, setError]             = useState(null);
  const [coords, setCoords]           = useState(null);
  const inputRef = useRef(null);

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

  const handleUseDemo = useCallback(() => {
    setCoords({ lat: DEMO_LOCATION.lat, lng: DEMO_LOCATION.lng, isDemo: true });
    setError(null);
  }, []);

  const handleManualChange = useCallback((c) => {
    setCoords({ ...c, isDemo: false });
    setError(null);
  }, []);

  const runSearch = useCallback(async (queryText, overrideCoords) => {
    const q = (queryText ?? text).trim();
    if (!q) { inputRef.current?.focus(); return; }

    // Fall back to SF demo automatically so first-time users always get results.
    let c = overrideCoords ?? coords;
    if (!c) {
      c = { lat: DEMO_LOCATION.lat, lng: DEMO_LOCATION.lng, isDemo: true };
      setCoords(c);
    }

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: q,
          lat: c.lat,
          lng: c.lng,
          tzOffsetMinutes: tzOffsetMinutes(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Server error ${res.status}`);
      }

      const data = await res.json();
      setParsedQuery(data.parsedQuery ?? null);
      setSource(data.source ?? null);
      setResults(data.results?.results ?? []);
    } catch (e) {
      setError(e.message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [text, coords]);

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
            <button
              className="search-btn"
              onClick={() => runSearch()}
              disabled={loading || locating}
              aria-busy={loading}
            >
              {loading ? <span className="spinner" aria-hidden="true" /> : <SearchIcon />}
              {loading ? "Searching…" : "Find help"}
            </button>
          </div>

          {results === null && !loading && (
            <div className="suggestions" aria-label="Example searches">
              {PLACEHOLDER_QUERIES.map((s) => (
                <button key={s} className="suggestion-chip" onClick={() => { setText(s); runSearch(s); }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </section>

        <LocationBar
          coords={coords}
          locating={locating}
          onUseBrowser={handleUseBrowser}
          onUseDemo={handleUseDemo}
          onManualChange={handleManualChange}
        />

        {error && (
          <div className="alert alert--error" role="alert">
            <strong>Error:</strong> {error}
          </div>
        )}

        {parsedQuery && !loading && (
          <QuerySummary query={parsedQuery} source={source} />
        )}

        {results !== null && !loading && (
          <section className="results-section" aria-label="Search results" aria-live="polite">
            {results.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state__icon" aria-hidden="true">🔍</p>
                <h3>No results found</h3>
                <p>Try expanding your search radius or changing your search terms.</p>
              </div>
            ) : (
              <>
                <h2 className="results-heading">
                  {results.length} result{results.length !== 1 ? "s" : ""} found
                </h2>
                <ul className="results-list" aria-label={`${results.length} organizations found`}>
                  {results.map((org) => (
                    <li key={org.id}><OrgCard org={org} /></li>
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
    </div>
  );
}
