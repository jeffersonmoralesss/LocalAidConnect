// AdminPage.jsx
// Admin moderation UI (REQ-3.5 + trust verification workflow).
// Reached via URL hash #admin. Two tabs:
//   - Reports: user-submitted reports with status transitions (REQ-3.5.1, 3.5.3)
//   - Unverified orgs: imported-from-OSM listings pending admin sign-off
//
// TODO: gate behind token-based auth (ADMIN_TOKEN) before production.

import { useState, useEffect, useCallback } from "react";
import { VerificationBadge, SourceBadge } from "./TrustBadges";

// ─── Shared labels ────────────────────────────────────────────
const REPORT_STATUS_OPTIONS = [
  { value: "NEW",          label: "New" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "APPLIED",      label: "Applied" },
  { value: "REJECTED",     label: "Rejected" },
];

const REPORT_TYPE_LABELS = {
  INCORRECT_HOURS:    "Incorrect hours",
  MOVED_LOCATION:     "Moved location",
  CLOSED_PERMANENTLY: "Closed permanently",
  INCORRECT_SERVICES: "Incorrect services",
};

function formatDate(iso) {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ═══════════════════════════════════════════════════════════════
// REPORTS TAB
// ═══════════════════════════════════════════════════════════════

function StatusBadge({ status }) {
  const cls = `status-badge status-badge--${status.toLowerCase()}`;
  const label = REPORT_STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
  return <span className={cls}>{label}</span>;
}

function ReportCard({ report, onUpdate, busy }) {
  const availableActions = [];
  if (report.status !== "UNDER_REVIEW") availableActions.push({ value: "UNDER_REVIEW", label: "Mark under review" });
  if (report.status !== "APPLIED")      availableActions.push({ value: "APPLIED",      label: "Mark applied" });
  if (report.status !== "REJECTED")     availableActions.push({ value: "REJECTED",     label: "Reject" });

  return (
    <article className="admin-report" aria-label={`Report #${report.id}`}>
      <header className="admin-report__header">
        <div className="admin-report__header-main">
          <span className="admin-report__type">{REPORT_TYPE_LABELS[report.reportType] ?? report.reportType}</span>
          <span className="admin-report__id">#{report.id}</span>
        </div>
        <StatusBadge status={report.status} />
      </header>

      <div className="admin-report__org">
        <strong>{report.organizationName}</strong>
        <div className="admin-report__org-address">{report.organizationAddress}</div>
      </div>

      <blockquote className="admin-report__message">{report.message}</blockquote>

      <div className="admin-report__footer">
        <span className="admin-report__date">Submitted {formatDate(report.createdAt)}</span>
        <div className="admin-report__actions">
          {availableActions.map((action) => (
            <button
              key={action.value}
              className={`admin-action-btn admin-action-btn--${action.value.toLowerCase()}`}
              onClick={() => onUpdate(report.id, action.value)}
              disabled={busy}
              aria-label={`${action.label} for report ${report.id}`}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

function ReportsView() {
  const [statusFilter, setStatusFilter] = useState("NEW");
  const [reports, setReports]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [updatingId, setUpdatingId]     = useState(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/admin/reports${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Load failed (${res.status})`);
      }
      const data = await res.json();
      setReports(data.results ?? []);
    } catch (e) {
      setError(e.message);
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadReports(); }, [loadReports]);

  const handleUpdate = async (reportId, newStatus) => {
    setUpdatingId(reportId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Update failed (${res.status})`);
      }
      await loadReports();
    } catch (e) {
      setError(e.message);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <>
      <div className="admin-toolbar">
        <label className="admin-toolbar__label" htmlFor="admin-status-filter">Status</label>
        <select
          id="admin-status-filter"
          className="admin-toolbar__select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All</option>
          {REPORT_STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <button className="admin-toolbar__refresh" onClick={loadReports} disabled={loading}
          aria-label="Refresh reports list">
          {loading ? "Loading…" : "↻ Refresh"}
        </button>

        <span className="admin-toolbar__count" aria-live="polite">
          {loading ? "" : `${reports.length} report${reports.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && reports.length === 0 && (
        <div className="empty-state">
          <p className="empty-state__icon" aria-hidden="true">📭</p>
          <h3>No reports</h3>
          <p>
            {statusFilter
              ? `No reports with status "${REPORT_STATUS_OPTIONS.find((s) => s.value === statusFilter)?.label ?? statusFilter}".`
              : "There are no reports yet."}
          </p>
        </div>
      )}

      {!loading && reports.length > 0 && (
        <ul className="admin-report-list" aria-label="Reports">
          {reports.map((report) => (
            <li key={report.id}>
              <ReportCard report={report} onUpdate={handleUpdate} busy={updatingId === report.id} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// UNVERIFIED ORGANIZATIONS TAB
// ═══════════════════════════════════════════════════════════════

function OrgReviewCard({ org, onVerify, busy }) {
  const fieldsMissing = [];
  if (!org.phone)   fieldsMissing.push("phone");
  if (!org.website) fieldsMissing.push("website");
  if (!org.address || org.address === "Address not available") fieldsMissing.push("address");

  return (
    <article className="admin-org" aria-label={`Unverified organization ${org.name}`}>
      <header className="admin-org__header">
        <div className="admin-org__header-main">
          <h3 className="admin-org__name">{org.name}</h3>
          <span className="admin-org__id">#{org.id}</span>
        </div>
        <div className="admin-org__badges">
          <VerificationBadge status={org.verification_status} lastVerifiedAt={org.last_verified_at} />
          <SourceBadge source={org.data_source} />
        </div>
      </header>

      <dl className="admin-org__meta">
        <div className="admin-org__meta-row">
          <dt>Address</dt>
          <dd>{org.address || <span className="admin-org__missing">missing</span>}</dd>
        </div>
        <div className="admin-org__meta-row">
          <dt>Phone</dt>
          <dd>{org.phone || <span className="admin-org__missing">missing</span>}</dd>
        </div>
        <div className="admin-org__meta-row">
          <dt>Website</dt>
          <dd>
            {org.website
              ? <a href={org.website} target="_blank" rel="noopener noreferrer">{org.website}</a>
              : <span className="admin-org__missing">missing</span>}
          </dd>
        </div>
        {org.source_url && (
          <div className="admin-org__meta-row">
            <dt>Source</dt>
            <dd>
              <a href={org.source_url} target="_blank" rel="noopener noreferrer"
                className="detail-meta__source-link">
                View on {org.data_source === "OSM" ? "OpenStreetMap" : "source"} ↗
              </a>
            </dd>
          </div>
        )}
        {org.imported_at && (
          <div className="admin-org__meta-row">
            <dt>Imported</dt>
            <dd>{formatDate(org.imported_at)}</dd>
          </div>
        )}
      </dl>

      {fieldsMissing.length > 0 && (
        <div className="admin-org__warn" role="note">
          ⚠ Missing: {fieldsMissing.join(", ")}. Verify only if you can confirm these details.
        </div>
      )}

      <div className="admin-org__actions">
        <button
          className="admin-action-btn admin-action-btn--applied"
          onClick={() => onVerify(org.id)}
          disabled={busy}
          aria-label={`Mark ${org.name} as verified`}
        >
          {busy ? "Verifying…" : "✓ Verify"}
        </button>
      </div>
    </article>
  );
}

function OrgsView() {
  const [orgs, setOrgs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [verifyingId, setVerifyingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/organizations?verification_status=UNVERIFIED");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Load failed (${res.status})`);
      }
      const data = await res.json();
      setOrgs(data.results ?? []);
    } catch (e) {
      setError(e.message);
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleVerify = async (orgId) => {
    setVerifyingId(orgId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/organizations/${orgId}/verify`, { method: "PATCH" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Verify failed (${res.status})`);
      }
      // Verified orgs drop out of this list automatically on reload.
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <>
      <div className="admin-toolbar">
        <span className="admin-toolbar__label">Unverified organizations</span>
        <button className="admin-toolbar__refresh" onClick={load} disabled={loading}
          aria-label="Refresh unverified organizations">
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
        <span className="admin-toolbar__count" aria-live="polite">
          {loading ? "" : `${orgs.length} org${orgs.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && orgs.length === 0 && (
        <div className="empty-state">
          <p className="empty-state__icon" aria-hidden="true">✅</p>
          <h3>Nothing pending review</h3>
          <p>All imported listings have been reviewed. New unverified rows will appear here as searches trigger OSM imports.</p>
        </div>
      )}

      {!loading && orgs.length > 0 && (
        <ul className="admin-org-list" aria-label="Unverified organizations">
          {orgs.map((org) => (
            <li key={org.id}>
              <OrgReviewCard org={org} onVerify={handleVerify} busy={verifyingId === org.id} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// Root admin page with tab switcher
// ═══════════════════════════════════════════════════════════════

const TABS = [
  { id: "reports", label: "Reports" },
  { id: "orgs",    label: "Unverified organizations" },
];

export default function AdminPage({ onExit }) {
  const [tab, setTab] = useState("reports");

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <div className="admin-page__header-inner">
          <div className="admin-page__title-block">
            <h1 className="admin-page__title">Admin</h1>
            <p className="admin-page__subtitle">Moderation &amp; data quality</p>
          </div>
          <button className="admin-page__exit" onClick={onExit} aria-label="Exit admin view">
            ← Back to search
          </button>
        </div>

        <nav className="admin-tabs" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`admin-tab${tab === t.id ? " admin-tab--active" : ""}`}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="admin-page__main">
        {tab === "reports" && <ReportsView />}
        {tab === "orgs"    && <OrgsView />}
      </main>
    </div>
  );
}
