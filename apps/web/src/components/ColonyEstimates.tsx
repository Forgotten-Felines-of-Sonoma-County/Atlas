"use client";

import { useState, useEffect } from "react";

interface ColonyEstimate {
  estimate_id: string;
  total_cats: number | null;
  adult_count: number | null;
  kitten_count: number | null;
  altered_count: number | null;
  unaltered_count: number | null;
  friendly_count: number | null;
  feral_count: number | null;
  source_type: string;
  source_label: string;
  observation_date: string | null;
  reported_at: string;
  is_firsthand: boolean;
  source_record_id: string | null;
  reporter_name: string | null;
  reporter_person_id: string | null;
  notes: string | null;
}

interface ColonyStatus {
  colony_size_estimate: number;
  verified_cat_count: number;
  verified_altered_count: number;
  final_confidence: number | null;
  estimate_count: number;
  primary_source: string | null;
  has_clinic_boost: boolean;
  is_multi_source_confirmed: boolean;
  estimated_work_remaining: number;
}

interface EcologyStats {
  a_known: number;
  n_recent_max: number;
  p_lower: number | null;
  p_lower_pct: number | null;
  estimation_method: string;
  has_eartip_data: boolean;
  total_eartips_seen: number;
  total_cats_seen: number;
  n_hat_chapman: number | null;
  p_hat_chapman_pct: number | null;
  best_colony_estimate: number | null;
  estimated_work_remaining: number | null;
}

interface ColonyEstimatesResponse {
  place_id: string;
  estimates: ColonyEstimate[];
  status: ColonyStatus;
  ecology: EcologyStats;
  has_data: boolean;
}

interface ColonyEstimatesProps {
  placeId: string;
}

// Source type colors
const sourceColors: Record<string, string> = {
  post_clinic_survey: "#6f42c1", // Purple for P75
  trapper_site_visit: "#0d6efd", // Blue
  manual_observation: "#198754", // Green
  trapping_request: "#fd7e14", // Orange
  intake_form: "#20c997", // Teal
  appointment_request: "#6c757d", // Gray
  verified_cats: "#dc3545", // Red
};

export function ColonyEstimates({ placeId }: ColonyEstimatesProps) {
  const [data, setData] = useState<ColonyEstimatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllEstimates, setShowAllEstimates] = useState(false);

  useEffect(() => {
    async function fetchEstimates() {
      try {
        const response = await fetch(`/api/places/${placeId}/colony-estimates`);
        if (!response.ok) {
          throw new Error("Failed to load colony estimates");
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading estimates");
      } finally {
        setLoading(false);
      }
    }
    fetchEstimates();
  }, [placeId]);

  if (loading) {
    return (
      <div style={{ padding: "1rem", color: "#666" }}>
        Loading colony estimates...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "1rem", background: "#fff3cd", borderRadius: "6px", color: "#856404" }}>
        Unable to load colony estimates
      </div>
    );
  }

  if (!data || !data.has_data) {
    return (
      <div style={{ padding: "1rem", color: "#666" }}>
        No colony size estimates available for this location.
      </div>
    );
  }

  const { status, estimates, ecology } = data;

  // Use ecology-based alteration rate when available
  const alterationRate = ecology?.p_lower_pct ?? (
    status.colony_size_estimate > 0
      ? Math.round((status.verified_altered_count / status.colony_size_estimate) * 100)
      : null
  );

  // Use best colony estimate from ecology if available
  const colonySize = ecology?.best_colony_estimate ?? status.colony_size_estimate;

  // Color for alteration rate
  let rateColor = "#6c757d";
  if (alterationRate !== null) {
    if (alterationRate >= 80) rateColor = "#198754";
    else if (alterationRate >= 50) rateColor = "#fd7e14";
    else rateColor = "#dc3545";
  }

  // Confidence display
  const confidencePct = status.final_confidence
    ? Math.round(status.final_confidence * 100)
    : null;

  // Estimates to show
  const visibleEstimates = showAllEstimates ? estimates : estimates.slice(0, 3);

  return (
    <div>
      {/* Summary Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "0.75rem",
            background: "#f8f9fa",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
            {ecology?.estimation_method === "mark_resight" ? `~${colonySize}` : colonySize}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#666" }}>
            Colony Size
            {ecology?.estimation_method === "mark_resight" && " (est.)"}
          </div>
        </div>

        <div
          style={{
            textAlign: "center",
            padding: "0.75rem",
            background: "#f8f9fa",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#198754" }}>
            {ecology?.a_known ?? status.verified_altered_count}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#666" }}>Verified Altered</div>
        </div>

        <div
          style={{
            textAlign: "center",
            padding: "0.75rem",
            background: "#f8f9fa",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: rateColor }}>
            {alterationRate !== null ? (
              ecology?.estimation_method === "max_recent" ? `≥${alterationRate}%` : `${alterationRate}%`
            ) : "--"}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#666" }}>
            Alteration Rate
            {ecology?.estimation_method === "max_recent" && " (min)"}
          </div>
        </div>

        <div
          style={{
            textAlign: "center",
            padding: "0.75rem",
            background: "#f8f9fa",
            borderRadius: "8px",
          }}
        >
          <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#fd7e14" }}>
            {ecology?.estimated_work_remaining ?? status.estimated_work_remaining}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#666" }}>Work Remaining</div>
        </div>
      </div>

      {/* Ecology-Based Estimation Info */}
      {ecology && ecology.a_known > 0 && (
        <div
          style={{
            background: "#f0f7ff",
            border: "1px solid #cce5ff",
            borderRadius: "8px",
            padding: "0.75rem",
            marginBottom: "1rem",
            fontSize: "0.85rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <strong>Ecology Estimate</strong>
            {ecology.estimation_method === "mark_resight" && (
              <span
                style={{
                  padding: "0.15rem 0.4rem",
                  background: "#198754",
                  color: "#fff",
                  borderRadius: "4px",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                }}
              >
                Ecology Grade
              </span>
            )}
            {ecology.estimation_method === "max_recent" && (
              <span
                style={{
                  padding: "0.15rem 0.4rem",
                  background: "#0d6efd",
                  color: "#fff",
                  borderRadius: "4px",
                  fontSize: "0.7rem",
                }}
              >
                Lower Bound
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", color: "#495057" }}>
            <span>
              <strong>{ecology.a_known}</strong> verified altered (A)
            </span>
            {ecology.n_recent_max > 0 && (
              <span>
                <strong>{ecology.n_recent_max}</strong> max reported (N)
              </span>
            )}
            {ecology.p_lower_pct !== null && (
              <span>
                Rate: <strong>≥{ecology.p_lower_pct}%</strong> (A/max(A,N))
              </span>
            )}
          </div>
          {ecology.has_eartip_data && ecology.n_hat_chapman && (
            <div style={{ marginTop: "0.5rem", color: "#155724" }}>
              Mark-resight estimate: <strong>~{ecology.n_hat_chapman} cats</strong>
              {ecology.p_hat_chapman_pct && ` (${ecology.p_hat_chapman_pct}% altered)`}
            </div>
          )}
        </div>
      )}

      {/* Confidence & Source Info */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "1rem",
          fontSize: "0.8rem",
        }}
      >
        {confidencePct !== null && (
          <span
            style={{
              padding: "0.25rem 0.5rem",
              background: confidencePct >= 70 ? "#d4edda" : confidencePct >= 40 ? "#fff3cd" : "#f8d7da",
              borderRadius: "4px",
            }}
          >
            Confidence: {confidencePct}%
          </span>
        )}
        {status.has_clinic_boost && (
          <span
            style={{
              padding: "0.25rem 0.5rem",
              background: "#d1ecf1",
              borderRadius: "4px",
              color: "#0c5460",
            }}
          >
            Clinic Verified
          </span>
        )}
        {status.is_multi_source_confirmed && (
          <span
            style={{
              padding: "0.25rem 0.5rem",
              background: "#d4edda",
              borderRadius: "4px",
              color: "#155724",
            }}
          >
            Multi-Source Confirmed
          </span>
        )}
        <span style={{ color: "#666" }}>
          {status.estimate_count} estimate{status.estimate_count !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Individual Estimates */}
      {estimates.length > 0 && (
        <div>
          <h4 style={{ margin: "1rem 0 0.5rem", fontSize: "0.9rem", fontWeight: 600 }}>
            Survey Responses
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {visibleEstimates.map((est) => (
              <div
                key={est.estimate_id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                  padding: "0.75rem",
                  background: "#f8f9fa",
                  borderRadius: "8px",
                  borderLeft: `3px solid ${sourceColors[est.source_type] || "#6c757d"}`,
                }}
              >
                {/* Source Badge */}
                <span
                  style={{
                    padding: "0.2rem 0.5rem",
                    background: sourceColors[est.source_type] || "#6c757d",
                    color: "#fff",
                    borderRadius: "4px",
                    fontSize: "0.7rem",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  {est.source_label}
                </span>

                {/* Details */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", fontSize: "0.85rem" }}>
                    {est.total_cats !== null && (
                      <span>
                        <strong>{est.total_cats}</strong> cats
                      </span>
                    )}
                    {est.adult_count !== null && (
                      <span style={{ color: "#666" }}>{est.adult_count} adults</span>
                    )}
                    {est.kitten_count !== null && (
                      <span style={{ color: "#666" }}>{est.kitten_count} kittens</span>
                    )}
                    {est.altered_count !== null && (
                      <span style={{ color: "#198754" }}>{est.altered_count} altered</span>
                    )}
                    {est.unaltered_count !== null && (
                      <span style={{ color: "#dc3545" }}>{est.unaltered_count} unaltered</span>
                    )}
                    {est.friendly_count !== null && (
                      <span style={{ color: "#0d6efd" }}>{est.friendly_count} friendly</span>
                    )}
                    {est.feral_count !== null && (
                      <span style={{ color: "#fd7e14" }}>{est.feral_count} feral</span>
                    )}
                  </div>

                  {/* Reporter and Date */}
                  <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "#666" }}>
                    {est.reporter_name && (
                      <span>
                        Reported by{" "}
                        {est.reporter_person_id ? (
                          <a href={`/people/${est.reporter_person_id}`} style={{ color: "#0d6efd" }}>
                            {est.reporter_name}
                          </a>
                        ) : (
                          est.reporter_name
                        )}
                        {" "}
                      </span>
                    )}
                    {est.observation_date && (
                      <span>
                        on {new Date(est.observation_date).toLocaleDateString()}
                      </span>
                    )}
                    {!est.observation_date && est.reported_at && (
                      <span>
                        on {new Date(est.reported_at).toLocaleDateString()}
                      </span>
                    )}
                    {est.is_firsthand && (
                      <span
                        style={{
                          marginLeft: "0.5rem",
                          padding: "0.1rem 0.3rem",
                          background: "#d4edda",
                          borderRadius: "3px",
                          fontSize: "0.65rem",
                        }}
                      >
                        Firsthand
                      </span>
                    )}
                  </div>

                  {/* Notes */}
                  {est.notes && (
                    <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", fontStyle: "italic", color: "#666" }}>
                      {est.notes}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Show More/Less */}
          {estimates.length > 3 && (
            <button
              onClick={() => setShowAllEstimates(!showAllEstimates)}
              style={{
                marginTop: "0.5rem",
                background: "transparent",
                border: "none",
                color: "#0d6efd",
                cursor: "pointer",
                fontSize: "0.8rem",
              }}
            >
              {showAllEstimates
                ? "Show less"
                : `Show ${estimates.length - 3} more estimate${estimates.length - 3 !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
