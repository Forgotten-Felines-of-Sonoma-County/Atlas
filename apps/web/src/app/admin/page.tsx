"use client";

import { useState, useEffect } from "react";
import { GeocodingControls } from "@/components/GeocodingControls";

interface QueueStats {
  total: number;
  by_status: Record<string, number>;
  by_source: Record<string, number>;
  by_geo_confidence: Record<string, number>;
}

// Status badge colors for visual clarity
const statusColors: Record<string, string> = {
  new: "#3b82f6",
  in_progress: "#f59e0b",
  scheduled: "#8b5cf6",
  complete: "#10b981",
  archived: "#6b7280",
};

const geoConfidenceColors: Record<string, string> = {
  exact: "#10b981",
  high: "#22c55e",
  medium: "#f59e0b",
  low: "#ef4444",
  "(pending)": "#6b7280",
};

export default function AdminPage() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDocs, setShowDocs] = useState(false);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then(setStats)
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "0 1rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ marginBottom: "0.25rem" }}>Admin Dashboard</h1>
        <p className="text-muted">System configuration and monitoring</p>
      </div>

      {/* Two Column Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "2rem", alignItems: "start" }}>

        {/* Main Content */}
        <div>
          {/* Admin Sections */}
          <div style={{ display: "grid", gap: "1.5rem" }}>

            {/* Operations Section */}
            <section>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-muted)" }}>Operations</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
                <AdminCard
                  href="/intake/queue"
                  title="Intake Queue"
                  description="Review and triage submissions"
                  icon="📥"
                />
                <AdminCard
                  href="/trappers"
                  title="Trappers"
                  description="Manage trapper assignments"
                  icon="🪤"
                />
                <AdminCard
                  href="/admin/duplicates"
                  title="Duplicates"
                  description="Review flagged conflicts"
                  icon="👥"
                  accent="#fef3c7"
                />
              </div>
            </section>

            {/* Configuration Section */}
            <section>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-muted)" }}>Configuration</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
                <AdminCard
                  href="/admin/ecology"
                  title="Ecology Config"
                  description="Colony calculation parameters"
                  icon="🌿"
                  accent="#ecfdf5"
                />
                <AdminCard
                  href="/admin/intake-fields"
                  title="Intake Fields"
                  description="Custom questions + Airtable"
                  icon="📝"
                  accent="#f0fdf4"
                />
                <AdminCard
                  href="/admin/source-confidence"
                  title="Source Confidence"
                  description="Data source trust levels"
                  icon="📊"
                />
                <AdminCard
                  href="/admin/staff"
                  title="Staff Directory"
                  description="Manage FFSC staff"
                  icon="👤"
                  accent="#fdf4ff"
                />
              </div>
            </section>

            {/* Data Management Section */}
            <section>
              <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem", color: "var(--text-muted)" }}>Data Management</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
                <AdminCard
                  href="/admin/ingest"
                  title="Data Ingest"
                  description="Sync and import status"
                  icon="🔄"
                />
                <AdminCard
                  href="/admin/test-mode"
                  title="Test Mode"
                  description="Temporary test changes"
                  icon="🧪"
                  accent="#fff7ed"
                />
              </div>
            </section>

            {/* Geocoding Controls */}
            <section className="card" style={{ padding: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Place Geocoding</h2>
                  <p className="text-muted text-sm" style={{ margin: "0.25rem 0 0 0" }}>
                    Normalize addresses and detect duplicates
                  </p>
                </div>
              </div>
              <GeocodingControls />
            </section>

            {/* Documentation (Collapsed by Default) */}
            <section className="card" style={{ padding: "1.25rem" }}>
              <button
                onClick={() => setShowDocs(!showDocs)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  textAlign: "left",
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Technical Documentation</h2>
                  <p className="text-muted text-sm" style={{ margin: "0.25rem 0 0 0" }}>
                    Data pipeline and form structure reference
                  </p>
                </div>
                <span style={{ fontSize: "1.25rem", transform: showDocs ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                  ▼
                </span>
              </button>

              {showDocs && (
                <div style={{ marginTop: "1.5rem" }}>
                  {/* Data Pipeline */}
                  <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Data Pipeline</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
                    <PipelineStep
                      number={1}
                      title="Intake"
                      description="Forms to web_intake_submissions, auto-triage, geocoding"
                    />
                    <PipelineStep
                      number={2}
                      title="Matching"
                      description="Link to People by email/phone, high-confidence auto-link"
                    />
                    <PipelineStep
                      number={3}
                      title="Requests"
                      description="Staff creates Requests from validated submissions"
                    />
                  </div>

                  {/* Scripts */}
                  <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Ingest Scripts</h3>
                  <div style={{ fontFamily: "monospace", fontSize: "0.8rem", display: "grid", gap: "0.25rem" }}>
                    <code style={{ padding: "0.25rem 0.5rem", background: "var(--card-border)", borderRadius: "4px" }}>
                      scripts/ingest/geocode_intake_addresses.mjs
                    </code>
                    <code style={{ padding: "0.25rem 0.5rem", background: "var(--card-border)", borderRadius: "4px" }}>
                      scripts/ingest/smart_match_intake.mjs
                    </code>
                    <code style={{ padding: "0.25rem 0.5rem", background: "var(--card-border)", borderRadius: "4px" }}>
                      scripts/ingest/normalize_intake_names.mjs
                    </code>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Sidebar - Stats */}
        <aside>
          <div className="card" style={{ padding: "1.25rem", position: "sticky", top: "1rem" }}>
            <h2 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem" }}>Intake Stats</h2>

            {loading ? (
              <p className="text-muted">Loading...</p>
            ) : stats ? (
              <div style={{ display: "grid", gap: "1.25rem" }}>
                {/* Total */}
                <div style={{ textAlign: "center", padding: "1rem", background: "var(--card-border)", borderRadius: "8px" }}>
                  <div style={{ fontSize: "2.5rem", fontWeight: 700, lineHeight: 1 }}>{stats.total}</div>
                  <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>Total Submissions</div>
                </div>

                {/* By Status */}
                <div>
                  <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", fontWeight: 600 }}>By Status</h4>
                  {Object.entries(stats.by_status || {}).map(([status, count]) => (
                    <div key={status} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0" }}>
                      <div style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: statusColors[status] || "#6b7280",
                      }} />
                      <span style={{ flex: 1, fontSize: "0.875rem" }}>{status || "(none)"}</span>
                      <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{count}</span>
                    </div>
                  ))}
                </div>

                {/* By Source */}
                <div>
                  <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", fontWeight: 600 }}>By Source</h4>
                  {Object.entries(stats.by_source || {}).map(([source, count]) => (
                    <div key={source} style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.875rem" }}>
                      <span>{source || "(none)"}</span>
                      <span style={{ fontWeight: 500 }}>{count}</span>
                    </div>
                  ))}
                </div>

                {/* Geocoding Quality */}
                <div>
                  <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", fontWeight: 600 }}>Geocoding Quality</h4>
                  {Object.entries(stats.by_geo_confidence || {}).map(([conf, count]) => (
                    <div key={conf} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0" }}>
                      <div style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: geoConfidenceColors[conf] || "#6b7280",
                      }} />
                      <span style={{ flex: 1, fontSize: "0.875rem" }}>{conf || "(pending)"}</span>
                      <span style={{ fontWeight: 500, fontSize: "0.875rem" }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-muted">Could not load stats</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// Admin card component
function AdminCard({
  href,
  title,
  description,
  icon,
  accent,
}: {
  href: string;
  title: string;
  description: string;
  icon: string;
  accent?: string;
}) {
  return (
    <a
      href={href}
      className="card"
      style={{
        padding: "1rem",
        display: "flex",
        gap: "0.75rem",
        alignItems: "flex-start",
        textDecoration: "none",
        color: "inherit",
        background: accent || undefined,
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <span style={{ fontSize: "1.5rem" }}>{icon}</span>
      <div>
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>{title}</h3>
        <p className="text-muted" style={{ margin: "0.25rem 0 0 0", fontSize: "0.8rem" }}>{description}</p>
      </div>
    </a>
  );
}

// Pipeline step component
function PipelineStep({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div style={{
      padding: "0.75rem",
      border: "1px solid var(--card-border)",
      borderRadius: "8px",
      position: "relative",
    }}>
      <div style={{
        position: "absolute",
        top: "-8px",
        left: "0.75rem",
        background: "var(--bg)",
        padding: "0 0.25rem",
        fontSize: "0.7rem",
        fontWeight: 600,
        color: "var(--text-muted)",
      }}>
        Step {number}
      </div>
      <h4 style={{ margin: "0.25rem 0 0.25rem 0", fontSize: "0.9rem" }}>{title}</h4>
      <p className="text-muted" style={{ margin: 0, fontSize: "0.75rem" }}>{description}</p>
    </div>
  );
}
