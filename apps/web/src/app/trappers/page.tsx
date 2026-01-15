"use client";

import { useState, useEffect, useCallback } from "react";
import { TrapperBadge } from "@/components/TrapperBadge";

interface Trapper {
  person_id: string;
  display_name: string;
  trapper_type: string;
  is_ffsc_trapper: boolean;
  active_assignments: number;
  completed_assignments: number;
  total_cats_caught: number;
  total_clinic_cats: number;
  unique_clinic_days: number;
  avg_cats_per_day: number;
  felv_positive_rate_pct: number | null;
  first_activity_date: string | null;
  last_activity_date: string | null;
}

interface AggregateStats {
  total_active_trappers: number;
  ffsc_trappers: number;
  community_trappers: number;
  all_clinic_cats: number;
  all_clinic_days: number;
  avg_cats_per_day_all: number;
  felv_positive_rate_pct_all: number | null;
  all_site_visits: number;
  first_visit_success_rate_pct_all: number | null;
  all_cats_caught: number;
}

interface TrappersResponse {
  trappers: Trapper[];
  aggregates: AggregateStats;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

function StatCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "1rem",
        background: "#f8f9fa",
        borderRadius: "8px",
      }}
    >
      <div style={{ fontSize: "1.75rem", fontWeight: "bold" }}>{value}</div>
      <div style={{ fontSize: "0.8rem", color: "#666" }}>{label}</div>
      {sublabel && (
        <div style={{ fontSize: "0.7rem", color: "#999", marginTop: "0.25rem" }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

export default function TrappersPage() {
  const [data, setData] = useState<TrappersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("total_clinic_cats");
  const [page, setPage] = useState(0);
  const limit = 25;

  const fetchTrappers = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (typeFilter !== "all") params.set("type", typeFilter);
    params.set("sort", sortBy);
    params.set("limit", String(limit));
    params.set("offset", String(page * limit));

    try {
      const response = await fetch(`/api/trappers?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch trappers");
      }
      const result: TrappersResponse = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, sortBy, page]);

  useEffect(() => {
    fetchTrappers();
  }, [fetchTrappers]);

  const agg = data?.aggregates;

  return (
    <div>
      <h1 style={{ marginBottom: "1.5rem" }}>Trappers</h1>

      {/* Aggregate Stats */}
      {agg && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: "1rem",
            marginBottom: "2rem",
          }}
        >
          <StatCard
            label="Active Trappers"
            value={agg.total_active_trappers}
            sublabel={`${agg.ffsc_trappers} FFSC, ${agg.community_trappers} Community`}
          />
          <StatCard label="Clinic Cats" value={agg.all_clinic_cats} />
          <StatCard label="Clinic Days" value={agg.all_clinic_days} />
          <StatCard
            label="Avg Cats/Day"
            value={agg.avg_cats_per_day_all || "—"}
          />
          <StatCard
            label="FeLV Rate"
            value={
              agg.felv_positive_rate_pct_all !== null
                ? `${agg.felv_positive_rate_pct_all}%`
                : "—"
            }
          />
          <StatCard label="Total Caught" value={agg.all_cats_caught} />
        </div>
      )}

      {/* Filters */}
      <div className="filters" style={{ marginBottom: "1.5rem" }}>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="all">All Trappers</option>
          <option value="ffsc">FFSC Trappers</option>
          <option value="community">Community Trappers</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value);
            setPage(0);
          }}
        >
          <option value="total_clinic_cats">Sort by Clinic Cats</option>
          <option value="total_cats_caught">Sort by Cats Caught</option>
          <option value="active_assignments">Sort by Active Assignments</option>
          <option value="completed_assignments">Sort by Completed</option>
          <option value="avg_cats_per_day">Sort by Avg Cats/Day</option>
          <option value="display_name">Sort by Name</option>
          <option value="last_activity_date">Sort by Last Activity</option>
        </select>
      </div>

      {loading && <div className="loading">Loading trappers...</div>}

      {error && <div className="empty" style={{ color: "red" }}>{error}</div>}

      {!loading && !error && data && (
        <>
          {data.trappers.length === 0 ? (
            <div className="empty">No trappers found.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th style={{ textAlign: "right" }}>Clinic Cats</th>
                  <th style={{ textAlign: "right" }}>Clinic Days</th>
                  <th style={{ textAlign: "right" }}>Cats/Day</th>
                  <th style={{ textAlign: "right" }}>Active</th>
                  <th style={{ textAlign: "right" }}>Completed</th>
                  <th style={{ textAlign: "right" }}>Total Caught</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {data.trappers.map((trapper) => (
                  <tr key={trapper.person_id}>
                    <td>
                      <a
                        href={`/trappers/${trapper.person_id}`}
                        style={{
                          fontWeight: 500,
                          color: "var(--foreground)",
                          textDecoration: "none",
                        }}
                      >
                        {trapper.display_name}
                      </a>
                    </td>
                    <td>
                      <TrapperBadge trapperType={trapper.trapper_type} size="sm" />
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontWeight:
                          trapper.total_clinic_cats > 0 ? 600 : "normal",
                        color:
                          trapper.total_clinic_cats > 0
                            ? "#198754"
                            : "inherit",
                      }}
                    >
                      {trapper.total_clinic_cats}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {trapper.unique_clinic_days}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {trapper.avg_cats_per_day}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        color:
                          trapper.active_assignments > 0
                            ? "#fd7e14"
                            : "#999",
                      }}
                    >
                      {trapper.active_assignments}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {trapper.completed_assignments}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 500 }}>
                      {trapper.total_cats_caught}
                    </td>
                    <td style={{ color: "#666", fontSize: "0.875rem" }}>
                      {trapper.last_activity_date
                        ? new Date(trapper.last_activity_date).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Pagination */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "1rem",
              marginTop: "1.5rem",
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </button>
            <span style={{ display: "flex", alignItems: "center", color: "#666" }}>
              Page {page + 1}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!data.pagination.hasMore}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
