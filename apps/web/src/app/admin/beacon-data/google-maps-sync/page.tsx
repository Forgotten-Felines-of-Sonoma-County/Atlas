"use client";

import { useState, useEffect, useCallback } from "react";

interface SyncStats {
  stats: Array<{ icon_meaning: string; count: number }>;
  totals: { total: number; with_icons: number; synced: number };
  lastSyncedAt: string | null;
}

interface SyncResult {
  updated: number;
  inserted: number;
  notMatched: number;
  iconDistribution: Record<string, number>;
}

const ICON_MEANING_COLORS: Record<string, string> = {
  difficult_client: "#1f2937",
  volunteer: "#84cc16",
  felv_colony: "#ea580c",
  disease_indicator: "#eab308",
  relocation: "#84cc16",
  high_priority: "#dc2626",
  standard: "#22c55e",
  attention: "#f59e0b",
  unknown: "#6b7280",
};

const ICON_MEANING_LABELS: Record<string, string> = {
  difficult_client: "Difficult Client (Black dots)",
  volunteer: "Volunteer (Stars)",
  felv_colony: "FeLV Colony (Orange diamonds)",
  disease_indicator: "Disease Indicator (Yellow squares)",
  relocation: "Relocation Client (Lime green)",
  high_priority: "High Priority (Red)",
  standard: "Standard Entry (Green)",
  attention: "Needs Attention (Orange)",
  unknown: "No Icon Data",
};

export default function GoogleMapsSyncPage() {
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SyncResult | null>(null);
  const [syncMode, setSyncMode] = useState<"update" | "sync">("update");

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/google-maps-sync");
      if (!response.ok) throw new Error("Failed to fetch stats");
      const data = await response.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", syncMode);

      const response = await fetch("/api/admin/google-maps-sync", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setSuccess(data.result);
      fetchStats(); // Refresh stats
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      // Reset the file input
      e.target.value = "";
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        Loading...
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
          Google Maps Icon Sync
        </h1>
        <p style={{ margin: "0.25rem 0 0", color: "#6b7280", fontSize: "0.875rem" }}>
          Sync icon styles from Google Maps to preserve visual indicators (difficult clients, volunteers, FeLV colonies, etc.)
        </p>
      </div>

      {/* Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            padding: "1rem",
            backgroundColor: "white",
            borderRadius: "0.5rem",
            border: "1px solid #e5e7eb",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>
            Total Entries
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
            {stats?.totals.total.toLocaleString() || 0}
          </div>
        </div>
        <div
          style={{
            padding: "1rem",
            backgroundColor: "white",
            borderRadius: "0.5rem",
            border: "1px solid #e5e7eb",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>
            With Icon Data
          </div>
          <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
            {stats?.totals.with_icons.toLocaleString() || 0}
            <span style={{ fontSize: "0.875rem", color: "#6b7280", marginLeft: "0.5rem" }}>
              ({stats?.totals.total ? Math.round((stats.totals.with_icons / stats.totals.total) * 100) : 0}%)
            </span>
          </div>
        </div>
        <div
          style={{
            padding: "1rem",
            backgroundColor: "white",
            borderRadius: "0.5rem",
            border: "1px solid #e5e7eb",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>
            Last Synced
          </div>
          <div style={{ fontSize: "1rem", fontWeight: 500 }}>
            {formatDate(stats?.lastSyncedAt || null)}
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div
        style={{
          padding: "1.5rem",
          backgroundColor: "white",
          borderRadius: "0.5rem",
          border: "1px solid #e5e7eb",
          marginBottom: "1.5rem",
        }}
      >
        <h2 style={{ margin: "0 0 1rem", fontSize: "1rem", fontWeight: 600 }}>
          Upload KMZ/KML File
        </h2>
        <p style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "1rem" }}>
          Download the KMZ from{" "}
          <a
            href="https://www.google.com/maps/d/u/0/viewer?mid=11ASW62IbxeTgnXmBTKIr5pyrDAc"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#3b82f6" }}
          >
            Google Maps
          </a>{" "}
          (Menu &gt; Download KMZ) and upload it here to sync icon styles.
        </p>

        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>
              Sync Mode
            </label>
            <select
              value={syncMode}
              onChange={(e) => setSyncMode(e.target.value as "update" | "sync")}
              style={{
                padding: "0.5rem",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
              }}
            >
              <option value="update">Update Only (entries missing icons)</option>
              <option value="sync">Full Sync (update all + add new)</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>
              File
            </label>
            <input
              type="file"
              accept=".kmz,.kml"
              onChange={handleUpload}
              disabled={uploading}
              style={{
                padding: "0.5rem",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
              }}
            />
          </div>

          {uploading && (
            <div style={{ color: "#6b7280", fontSize: "0.875rem" }}>
              Processing...
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.75rem",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "0.375rem",
              color: "#b91c1c",
              fontSize: "0.875rem",
            }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.75rem",
              backgroundColor: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
            }}
          >
            <div style={{ fontWeight: 600, color: "#166534", marginBottom: "0.5rem" }}>
              Sync Complete
            </div>
            <div style={{ color: "#15803d" }}>
              Updated: {success.updated} entries
              {success.inserted > 0 && ` | Inserted: ${success.inserted} new`}
              {success.notMatched > 0 && ` | Not matched: ${success.notMatched}`}
            </div>
          </div>
        )}
      </div>

      {/* Icon Meaning Distribution */}
      <div
        style={{
          padding: "1.5rem",
          backgroundColor: "white",
          borderRadius: "0.5rem",
          border: "1px solid #e5e7eb",
        }}
      >
        <h2 style={{ margin: "0 0 1rem", fontSize: "1rem", fontWeight: 600 }}>
          Icon Meaning Distribution
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {stats?.stats.map((item) => {
            const percentage = stats.totals.total
              ? (item.count / stats.totals.total) * 100
              : 0;
            const meaning = item.icon_meaning || "unknown";
            return (
              <div
                key={meaning}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <div
                  style={{
                    width: "1rem",
                    height: "1rem",
                    borderRadius: "0.25rem",
                    backgroundColor: ICON_MEANING_COLORS[meaning] || "#6b7280",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "0.875rem" }}>
                      {ICON_MEANING_LABELS[meaning] || meaning}
                    </span>
                    <span style={{ fontSize: "0.875rem", color: "#6b7280" }}>
                      {item.count.toLocaleString()} ({percentage.toFixed(1)}%)
                    </span>
                  </div>
                  <div
                    style={{
                      height: "0.25rem",
                      backgroundColor: "#e5e7eb",
                      borderRadius: "0.125rem",
                      marginTop: "0.25rem",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${percentage}%`,
                        backgroundColor: ICON_MEANING_COLORS[meaning] || "#6b7280",
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Help Section */}
      <div
        style={{
          marginTop: "1.5rem",
          padding: "1rem",
          backgroundColor: "#f9fafb",
          borderRadius: "0.5rem",
          fontSize: "0.875rem",
          color: "#4b5563",
        }}
      >
        <strong>Icon Meanings:</strong>
        <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.5rem" }}>
          <li><strong>Black dots (icon-503-000000)</strong>: Difficult clients, watch list</li>
          <li><strong>Stars (icon-959)</strong>: Volunteers</li>
          <li><strong>Orange diamonds (icon-961-F8971B)</strong>: FeLV colonies</li>
          <li><strong>Yellow squares (icon-960)</strong>: Disease indicators</li>
          <li><strong>Lime green (icon-503-CDDC39)</strong>: Relocation clients</li>
          <li><strong>Red (icon-503-DB4436)</strong>: High priority</li>
          <li><strong>Green (icon-503-009D57)</strong>: Standard entries</li>
        </ul>
      </div>
    </div>
  );
}
