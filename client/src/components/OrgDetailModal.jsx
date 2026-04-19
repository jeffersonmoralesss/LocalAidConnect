// OrgDetailModal.jsx
// Organization detail view (REQ-3.3.1, REQ-3.3.2, REQ-3.3.3)
// Renders as an accessible modal dialog.
// Fetches GET /api/organizations/:id for the full hours schedule.
// Includes inline Report Issue form (REQ-3.4).

import { useEffect, useRef, useState, useCallback } from "react";
import { PhoneIcon, DirectionsIcon, WebIcon, CloseIcon } from "./Icons";
import { VerificationBadge, SourceBadge } from "./TrustBadges";

// ── Day helpers ───────────────────────────────────────────────
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Report form constants ────────────────────────────────────
const REPORT_TYPES = [
  { value: "INCORRECT_HOURS",    label: "Incorrect hours" },
  { value: "MOVED_LOCATION",     label: "Moved location" },
  { value: "CLOSED_PERMANENTLY", label: "Closed permanently" },
  { value: "INCORRECT_SERVICES", label: "Incorrect services" },
];
const MAX_MESSAGE_LENGTH = 2000;

// ── Utils ────────────────────────────────────────────────────
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
        if (cost) tags.push(cost);
        if (s.walkInIndicator) tags.push("Walk-in");
        if (!s.idRequirementIndicator) tags.push("No ID required");
        else                            tags.push("ID required");

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

// ── Inline Report Form ───────────────────────────────────────
// REQ-3.4.1, REQ-3.4.2. Keeps focus inside the modal (form fields
// are picked up by the existing focus trap).
function ReportIssueSection({ organizationId }) {
  const [open, setOpen]     = useState(false);
  const [type, setType]     = useState(REPORT_TYPES[0].value);
  const [message, setMsg]   = useState("");
  const [state, setState]   = useState("idle"); // idle | submitting | success | error
  const [error, setError]   = useState(null);

  const typeRef    = useRef(null);
  const successRef = useRef(null);
  const triggerRef = useRef(null);

  // When form opens, move focus to the type select
  useEffect(() => {
    if (open && state === "idle") typeRef.current?.focus();
  }, [open, state]);

  // When success state appears, announce it
  useEffect(() => {
    if (state === "success") successRef.current?.focus();
  }, [state]);

  const reset = () => {
    setType(REPORT_TYPES[0].value);
    setMsg("");
    setState("idle");
    setError(null);
  };

  const handleOpen = () => { reset(); setOpen(true); };

  const handleCancel = () => {
    setOpen(false);
    reset();
    triggerRef.current?.focus();
  };

  const handleClose = () => {
    setOpen(false);
    reset();
    triggerRef.current?.focus();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const trimmed = message.trim();
    if (!trimmed) {
      setError("Please describe the issue.");
      return;
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      setError(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
      return;
    }

    setState("submitting");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          reportType: type,
          message: trimmed,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Submission failed (${res.status})`);
      }
      setState("success");
    } catch (e) {
      setState("error");
      setError(e.message);
    }
  };

  // ── Collapsed trigger ──
  if (!open && state !== "success") {
    return (
      <div className="report-form report-form--collapsed">
        <button
          ref={triggerRef}
          type="button"
          className="report-form__trigger"
          onClick={handleOpen}
          aria-expanded="false"
          aria-controls="report-form-panel"
        >
          ⚑ Report an issue with this listing
        </button>
      </div>
    );
  }

  // ── Success ──
  if (state === "success") {
    return (
      <div
        className="report-form report-form--success"
        id="report-form-panel"
        role="status"
        aria-live="polite"
      >
        <h4 ref={successRef} tabIndex={-1} className="report-form__success-heading">
          ✓ Thanks — report submitted
        </h4>
        <p className="report-form__success-msg">
          Our team will review the report. No further action is needed from you.
        </p>
        <div className="report-form__actions">
          <button
            type="button"
            className="report-form__btn report-form__btn--secondary"
            onClick={() => { reset(); setOpen(true); }}
          >
            Submit another report
          </button>
          <button
            type="button"
            className="report-form__btn report-form__btn--secondary"
            onClick={handleClose}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // ── Open form ──
  const submitting = state === "submitting";

  return (
    <form
      className="report-form"
      id="report-form-panel"
      onSubmit={handleSubmit}
      aria-label="Report an issue with this listing"
      noValidate
    >
      <div className="report-form__header">
        <h4 className="report-form__title">Report an issue</h4>
      </div>

      <div className="report-form__field">
        <label className="report-form__label" htmlFor="report-type-select">
          What's the issue?
        </label>
        <select
          id="report-type-select"
          ref={typeRef}
          className="report-form__select"
          value={type}
          onChange={(e) => setType(e.target.value)}
          disabled={submitting}
        >
          {REPORT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="report-form__field">
        <label className="report-form__label" htmlFor="report-message">
          Details
          <span className="report-form__label-hint">
            {message.length}/{MAX_MESSAGE_LENGTH}
          </span>
        </label>
        <textarea
          id="report-message"
          className="report-form__textarea"
          rows={4}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Describe what's wrong (e.g. 'Phone number is disconnected', 'Building is vacant')…"
          value={message}
          onChange={(e) => setMsg(e.target.value)}
          disabled={submitting}
          required
          aria-describedby={error ? "report-form-error" : undefined}
          aria-invalid={error ? "true" : undefined}
        />
      </div>

      {error && (
        <div id="report-form-error" className="report-form__error" role="alert">
          {error}
        </div>
      )}

      <div className="report-form__actions">
        <button
          type="submit"
          className="report-form__btn report-form__btn--primary"
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting ? "Submitting…" : "Submit report"}
        </button>
        <button
          type="button"
          className="report-form__btn report-form__btn--secondary"
          onClick={handleCancel}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Modal ─────────────────────────────────────────────────────
export default function OrgDetailModal({ org, onClose }) {
  const [detail, setDetail]         = useState(null);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const dialogRef = useRef(null);
  const closeRef  = useRef(null);

  // ── Fetch full detail ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetch(`/api/organizations/${org.id}`)
      .then((r) => { if (!r.ok) throw new Error(`Server error ${r.status}`); return r.json(); })
      .then((data) => { if (!cancelled) { setDetail(data); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setFetchError(e.message); setLoading(false); } });

    return () => { cancelled = true; };
  }, [org.id]);

  // ── Focus management: close-button focused on open, restore on close ──
  useEffect(() => {
    closeRef.current?.focus();
    const trigger = document.activeElement;
    return () => { trigger?.focus(); };
  }, []);

  // ── Escape key + focus trap ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab") return;
      const el = dialogRef.current;
      if (!el) return;
      const focusable = Array.from(
        el.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  // ── Prevent body scroll while open ──
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const display = detail ?? org;
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(display.address)}`;

  return (
    <div className="modal-overlay" role="presentation" onClick={handleBackdropClick} aria-hidden="false">
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-org-name"
        aria-describedby="modal-org-address"
      >
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

        <div className="modal__body">

          {/* ── Contact block ── */}
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
                  aria-label="Visit website (opens in new tab)">
                  <WebIcon size={13} /> {display.website.replace(/^https?:\/\//, "")}
                </a>
              </p>
            )}
          </section>

          {/* ── One-click actions (REQ-3.3.3) ── */}
          {/* Guard every action-btn so missing fields don't render broken links. */}
          <div className="modal__actions">
            {display.phone && (
              <a href={`tel:${display.phone}`} className="action-btn action-btn--call action-btn--lg"
                aria-label={`Call ${display.name}`}>
                <PhoneIcon /> Call
              </a>
            )}
            {display.address && (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                className="action-btn action-btn--dir action-btn--lg"
                aria-label={`Get directions to ${display.name} (opens in new tab)`}>
                <DirectionsIcon /> Directions
              </a>
            )}
            {display.website && (
              <a href={display.website} target="_blank" rel="noopener noreferrer"
                className="action-btn action-btn--web action-btn--lg"
                aria-label={`Visit ${display.name} website (opens in new tab)`}>
                <WebIcon /> Website
              </a>
            )}
          </div>

          {/* ── Services ── */}
          <section className="modal__section" aria-label="Services offered">
            <h3 className="modal__section-title">Services</h3>
            <ServicesList services={display.services} />
          </section>

          {/* ── Hours ── */}
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
            {!loading && !fetchError && detail && <HoursSchedule hours={detail.hours} />}
          </section>

          {/* ── Verification (REQ-3.3.2 + trust labels) ── */}
          <section className="modal__section modal__section--meta" aria-label="Verification information">
            <div className="detail-trust-row">
              <VerificationBadge
                status={display.verification_status}
                lastVerifiedAt={display.last_verified_at}
                size="md"
              />
              <SourceBadge source={display.data_source} size="md" />
            </div>
            <dl className="detail-meta">
              <div className="detail-meta__row">
                <dt>Last verified</dt>
                <dd>
                  {display.last_verified_at
                    ? display.last_verified_at.slice(0, 10)
                    : <span className="detail-meta__never">Not verified yet</span>}
                </dd>
              </div>
              {display.source_url && (
                <div className="detail-meta__row">
                  <dt>Source</dt>
                  <dd>
                    <a href={display.source_url} target="_blank" rel="noopener noreferrer"
                      className="detail-meta__source-link">
                      View on {display.data_source === "OSM" ? "OpenStreetMap" : "source"} ↗
                    </a>
                  </dd>
                </div>
              )}
              {org.distanceMiles != null && (
                <div className="detail-meta__row">
                  <dt>Distance</dt>
                  <dd>{org.distanceMiles} mi from your location</dd>
                </div>
              )}
            </dl>
          </section>

          {/* ── Report issue (REQ-3.4) ── */}
          <section className="modal__section" aria-label="Report an issue with this listing">
            <h3 className="modal__section-title">Something wrong?</h3>
            <ReportIssueSection organizationId={display.id} />
          </section>

        </div>
      </div>
    </div>
  );
}
