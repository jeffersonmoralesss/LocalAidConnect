// OrgDetailModal.jsx
// Organization detail view (REQ-3.3.1, REQ-3.3.2, REQ-3.3.3)
// Renders as an accessible modal dialog.
// Fetches GET /api/organizations/:id for the full hours schedule.

import { useEffect, useRef, useState, useCallback } from "react";
import { PhoneIcon, DirectionsIcon, WebIcon, CloseIcon } from "./Icons";

// ── Day helpers ───────────────────────────────────────────────
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(timeStr) {
  if (!timeStr) return "";
  const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return timeStr;
  const h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function formatCost(indicator) {
  const map = { FREE: "Free", LOW_COST: "Low cost", SLIDING_SCALE: "Sliding scale", PAID: "Paid" };
  return indicator ? (map[indicator] ?? indicator) : null;
}

function formatServiceType(type) {
  if (!type) return type;
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Sub-components ────────────────────────────────────────────

function OpenBadge({ status }) {
  if (status === true)  return <span className="badge badge--open">Open now</span>;
  if (status === false) return <span className="badge badge--closed">Closed now</span>;
  return <span className="badge badge--unknown">Hours unknown</span>;
}

function HoursSchedule({ hours }) {
  if (!hours || hours.length === 0) {
    return <p className="detail-empty-note">No hours information available.</p>;
  }

  // Build a map: dayOfWeek → rows (could be multiple per day)
  const byDay = new Map();
  for (const h of hours) {
    if (!byDay.has(h.dayOfWeek)) byDay.set(h.dayOfWeek, []);
    byDay.get(h.dayOfWeek).push(h);
  }

  const today = new Date().getDay();

  return (
    <table className="hours-table" aria-label="Weekly hours schedule">
      <tbody>
        {[0, 1, 2, 3, 4, 5, 6].map((day) => {
          const rows = byDay.get(day) ?? [];
          const isToday = day === today;

          let hoursText;
          if (rows.length === 0) {
            hoursText = <span className="hours-table__closed">Unknown</span>;
          } else if (rows.every((r) => r.closedIndicator)) {
            hoursText = <span className="hours-table__closed">Closed</span>;
          } else {
            const openRows = rows.filter((r) => !r.closedIndicator);
            hoursText = openRows.map((r, i) => (
              <span key={i} className="hours-table__range">
                {formatTime(r.openTime)}–{formatTime(r.closeTime)}
              </span>
            ));
          }

          return (
            <tr key={day} className={isToday ? "hours-table__row--today" : undefined}>
              <th scope="row" className="hours-table__day">
                <span className="hours-table__day-short" aria-hidden="true">{DAY_SHORT[day]}</span>
                <span className="sr-only">{DAY_NAMES[day]}</span>
                {isToday && <span className="hours-today-dot" aria-hidden="true" />}
              </th>
              <td className="hours-table__hours">{hoursText}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ServicesList({ services }) {
  if (!services || services.length === 0) {
    return <p className="detail-empty-note">No services listed.</p>;
  }
  return (
    <ul className="detail-services-list">
      {services.map((s) => {
        const cost = formatCost(s.costIndicator);
        const tags = [];
        if (cost)                   tags.push(cost);
        if (s.walkInIndicator)      tags.push("Walk-in");
        if (!s.idRequirementIndicator) tags.push("No ID required");
        else                           tags.push("ID required");

        return (
          <li key={s.id} className="detail-service-item">
            <div className="detail-service-item__type">{formatServiceType(s.serviceType)}</div>
            <p className="detail-service-item__eligibility">{s.eligibilityDescription}</p>
            <div className="detail-service-item__tags">
              {tags.map((t) => <span key={t} className="service-tag">{t}</span>)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── Modal ─────────────────────────────────────────────────────

/**
 * OrgDetailModal
 * Props:
 *   org: the org object from the results list (pre-fetched data)
 *   onClose: () => void
 */
export default function OrgDetailModal({ org, onClose }) {
  const [detail, setDetail] = useState(null);   // full detail incl. hours
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const dialogRef = useRef(null);
  const closeRef  = useRef(null);

  // ── Fetch full detail ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetch(`/api/organizations/${org.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) { setDetail(data); setLoading(false); }
      })
      .catch((e) => {
        if (!cancelled) { setFetchError(e.message); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [org.id]);

  // ── Accessibility: focus management ────────────────────────
  useEffect(() => {
    // Move focus to close button when modal opens
    closeRef.current?.focus();
    // Restore focus to the element that opened the modal on unmount
    const trigger = document.activeElement;
    return () => { trigger?.focus(); };
  }, []);

  // ── Accessibility: Escape key ────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();

      // Simple focus trap: Tab / Shift+Tab cycles within the dialog
      if (e.key !== "Tab") return;
      const el = dialogRef.current;
      if (!el) return;
      const focusable = Array.from(
        el.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // ── Prevent body scroll while open ──────────────────────────
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  // Use fetched detail if available, else fall back to partial org from results
  const display = detail ?? org;
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(display.address)}`;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={handleBackdropClick}
      aria-hidden="false"
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-org-name"
        aria-describedby="modal-org-address"
      >
        {/* ── Header ── */}
        <div className="modal__header">
          <div className="modal__title-block">
            <h2 id="modal-org-name" className="modal__name">{display.name}</h2>
            <OpenBadge status={org.openNowStatus} />
          </div>
          <button
            ref={closeRef}
            className="modal__close-btn"
            onClick={onClose}
            aria-label="Close organization detail"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="modal__body">

          {/* Contact block */}
          <section className="modal__section modal__section--contact" aria-label="Contact information">
            <p id="modal-org-address" className="modal__address">{display.address}</p>
            {display.phone && (
              <p className="modal__phone">
                <a href={`tel:${display.phone}`} aria-label={`Call ${display.phone}`}>
                  <PhoneIcon size={13} /> {display.phone}
                </a>
              </p>
            )}
            {display.website && (
              <p className="modal__website">
                <a href={display.website} target="_blank" rel="noopener noreferrer"
                  aria-label={`Visit website (opens in new tab)`}>
                  <WebIcon size={13} /> {display.website.replace(/^https?:\/\//, "")}
                </a>
              </p>
            )}
          </section>

          {/* One-click actions (REQ-3.3.3) */}
          <div className="modal__actions">
            <a href={`tel:${display.phone}`} className="action-btn action-btn--call action-btn--lg"
              aria-label={`Call ${display.name}`}>
              <PhoneIcon /> Call
            </a>
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
              className="action-btn action-btn--dir action-btn--lg"
              aria-label={`Get directions to ${display.name} (opens in new tab)`}>
              <DirectionsIcon /> Directions
            </a>
            {display.website && (
              <a href={display.website} target="_blank" rel="noopener noreferrer"
                className="action-btn action-btn--web action-btn--lg"
                aria-label={`Visit ${display.name} website (opens in new tab)`}>
                <WebIcon /> Website
              </a>
            )}
          </div>

          {/* Services (REQ-3.3.2) */}
          <section className="modal__section" aria-label="Services offered">
            <h3 className="modal__section-title">Services</h3>
            <ServicesList services={display.services} />
          </section>

          {/* Hours (REQ-3.3.2) */}
          <section className="modal__section" aria-label="Operating hours">
            <h3 className="modal__section-title">Hours</h3>
            {loading && (
              <div className="modal__loading" aria-live="polite" aria-label="Loading hours">
                <span className="spinner" aria-hidden="true" />
                <span>Loading hours…</span>
              </div>
            )}
            {fetchError && (
              <p className="detail-empty-note">Could not load hours: {fetchError}</p>
            )}
            {!loading && !fetchError && detail && (
              <HoursSchedule hours={detail.hours} />
            )}
          </section>

          {/* Verification (REQ-3.3.2) */}
          <section className="modal__section modal__section--meta" aria-label="Verification information">
            <dl className="detail-meta">
              <div className="detail-meta__row">
                <dt>Status</dt>
                <dd>
                  <span className={`verify-badge verify-badge--${(display.verification_status ?? "").toLowerCase()}`}>
                    {display.verification_status ?? "Unknown"}
                  </span>
                </dd>
              </div>
              <div className="detail-meta__row">
                <dt>Last verified</dt>
                <dd>{display.last_verified_at ? display.last_verified_at.slice(0, 10) : "Unknown"}</dd>
              </div>
              {org.distanceMiles != null && (
                <div className="detail-meta__row">
                  <dt>Distance</dt>
                  <dd>{org.distanceMiles} mi from your location</dd>
                </div>
              )}
            </dl>
          </section>

        </div>{/* /modal__body */}
      </div>{/* /modal */}
    </div>
  );
}
