import { useState, useCallback, useRef } from "react";
import "./App.css";

// ── Constants ────────────────────────────────────────────────
const PLACEHOLDER_QUERIES = [
  "I need free food near me, open now",
  "looking for a shelter that takes walk-ins tonight",
  "free clinic within 5 miles, no ID needed",
  "mental health counseling this week",
  "legal aid, low cost",
];

// ── Helpers ──────────────────────────────────────────────────
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by your browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error("Location access was denied. Please enter your coordinates manually or allow location access."))
    );
  });
}

function tzOffsetMinutes() {
  return -new Date().getTimezoneOffset(); // JS offset is inverted vs. UTC convention
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
  const telUrl  = `tel:${org.phone}`;

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
            {org.services.map((s) => (
              <ServiceTag key={s.id} service={s} />
            ))}
          </div>
        )}
      </div>

      <footer className="org-card__actions">
        <a href={telUrl} className="action-btn action-btn--call">
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

// ── Inline SVG icons (no external dep) ──────────────────────
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
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
  </svg>
);

// ── ParsedQuery pill display ─────────────────────────────────
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

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const [text, setText]             = useState("");
  const [results, setResults]       = useState(null);   // null = not yet searched
  const [parsedQuery, setParsedQuery] = useState(null);
  const [source, setSource]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [locating, setLocating]     = useState(false);
  const [error, setError]           = useState(null);
  const [coords, setCoords]         = useState(null);   // { lat, lng } once obtained
  const inputRef = useRef(null);

  // Try to get location silently on first search if not already obtained
  const ensureCoords = useCallback(async () => {
    if (coords) return coords;
    setLocating(true);
    try {
      const c = await getLocation();
      setCoords(c);
      setLocating(false);
      return c;
    } catch (e) {
      setLocating(false);
      throw e;
    }
  }, [coords]);

  const handleSearch = useCallback(async (queryText) => {
    const q = (queryText ?? text).trim();
    if (!q) {
      inputRef.current?.focus();
      return;
    }

    setError(null);
    setLoading(true);

    let c;
    try {
      c = await ensureCoords();
    } catch (e) {
      setError(e.message);
      setLoading(false);
      return;
    }

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
      // Backend shape: { source, parsedQuery, results: { results: [...] } }
      setParsedQuery(data.parsedQuery ?? null);
      setSource(data.source ?? null);
      setResults(data.results?.results ?? []);
    } catch (e) {
      setError(e.message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [text, ensureCoords]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleLocate = async () => {
    setError(null);
    setLocating(true);
    try {
      const c = await getLocation();
      setCoords(c);
    } catch (e) {
      setError(e.message);
    } finally {
      setLocating(false);
    }
  };

  const handleSuggestion = (s) => {
    setText(s);
    handleSearch(s);
  };

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-header__inner">
          <div className="logo">
            <span className="logo__mark" aria-hidden="true">◈</span>
            <span className="logo__text">LocalAid<em>Connect</em></span>
          </div>
          <p className="app-header__tagline">Find nearby services — food, shelter, clinics &amp; more</p>
        </div>
      </header>

      {/* ── Search bar ── */}
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
                onKeyDown={handleKeyDown}
                autoComplete="off"
                spellCheck={false}
                aria-label="Describe what you need"
              />
              <button
                className={`locate-btn${coords ? " locate-btn--active" : ""}${locating ? " locate-btn--spin" : ""}`}
                onClick={handleLocate}
                title={coords ? "Location obtained — click to refresh" : "Use my location"}
                aria-label="Use my location"
                disabled={locating}
              >
                <LocateIcon />
              </button>
            </div>

            <button
              className="search-btn"
              onClick={() => handleSearch()}
              disabled={loading || locating}
              aria-busy={loading}
            >
              {loading ? <span className="spinner" aria-hidden="true" /> : <SearchIcon />}
              {loading ? "Searching…" : "Find help"}
            </button>
          </div>

          {/* Suggestion chips */}
          {results === null && !loading && (
            <div className="suggestions" aria-label="Example searches">
              {PLACEHOLDER_QUERIES.map((s) => (
                <button key={s} className="suggestion-chip" onClick={() => handleSuggestion(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Error ── */}
        {error && (
          <div className="alert alert--error" role="alert">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* ── Parsed query summary ── */}
        {parsedQuery && !loading && (
          <QuerySummary query={parsedQuery} source={source} />
        )}

        {/* ── Results ── */}
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
                    <li key={org.id}>
                      <OrgCard org={org} />
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
    </div>
  );
}
