// TrustBadges.jsx
// Small reusable component to display verification + source labels consistently
// across result cards, modal, and admin views.
//
// Trust rules surfaced here:
//   - VERIFIED = green ✓ badge + the verified date
//   - UNVERIFIED = amber ⚠ badge; if last_verified_at is null, show "Not verified yet"
//   - data_source (OSM / LOCAL) is shown as a small grey chip next to the badge

export function VerificationBadge({ status, lastVerifiedAt, size = "sm" }) {
  const cls = `trust-badge trust-badge--${size}`;

  if (status === "VERIFIED") {
    return (
      <span className={`${cls} trust-badge--verified`} title="Verified by admin">
        <span aria-hidden="true">✓</span> Verified
      </span>
    );
  }

  // UNVERIFIED (or anything else — OSM imports, pending, null status)
  // When last_verified_at is null, the SRS-style "last verified" line would
  // read as misleading. This badge makes the unverified state loud and clear.
  const label = lastVerifiedAt === null || lastVerifiedAt === undefined
    ? "Not verified yet"
    : "Unverified";

  return (
    <span className={`${cls} trust-badge--unverified`} title={label}>
      <span aria-hidden="true">⚠</span> {label}
    </span>
  );
}

export function SourceBadge({ source, size = "sm" }) {
  if (!source) return null;
  const cls = `source-badge source-badge--${size} source-badge--${source.toLowerCase()}`;
  const label = source === "OSM" ? "from OpenStreetMap" : "locally curated";
  return (
    <span className={cls} title={label}>
      {source}
    </span>
  );
}

/**
 * VerifiedOnLine
 * Human-readable "Last verified" line. Handles null (unverified) explicitly.
 */
export function VerifiedOnLine({ lastVerifiedAt }) {
  if (!lastVerifiedAt) {
    return <span className="verified-line verified-line--never">Not verified yet</span>;
  }
  // Show just the date portion (ISO or "YYYY-MM-DD HH:MM:SS" both start with YYYY-MM-DD)
  return (
    <span className="verified-line">
      Last verified: {lastVerifiedAt.slice(0, 10)}
    </span>
  );
}
