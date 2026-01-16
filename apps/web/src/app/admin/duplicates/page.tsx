"use client";

import { useState, useEffect, useCallback } from "react";

interface PotentialDuplicate {
  duplicate_id: string;
  new_person_id: string;
  new_name: string;
  existing_person_id: string;
  existing_name: string;
  match_type: string;
  matched_identifier: string;
  name_similarity: number;
  new_source_system: string;
  existing_source_system: string;
  new_confidence: number;
  existing_confidence: number;
  created_at: string;
  new_person_requests: number;
  existing_person_requests: number;
  new_person_submissions: number;
  existing_person_submissions: number;
}

interface DuplicateResponse {
  duplicates: PotentialDuplicate[];
  counts: {
    pending: number;
    merged: number;
    kept_separate: number;
    dismissed: number;
  };
  note?: string;
}

export default function DuplicatesPage() {
  const [data, setData] = useState<DuplicateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("pending");
  const [resolving, setResolving] = useState<string | null>(null);

  const fetchDuplicates = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/duplicates?status=${status}`);
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error("Failed to fetch duplicates:", error);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchDuplicates();
  }, [fetchDuplicates]);

  const handleResolve = async (duplicateId: string, action: string) => {
    setResolving(duplicateId);
    try {
      const response = await fetch("/api/admin/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicate_id: duplicateId, action }),
      });

      if (response.ok) {
        fetchDuplicates();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error("Failed to resolve:", error);
    } finally {
      setResolving(null);
    }
  };

  const formatMatchType = (type: string) => {
    switch (type) {
      case "email_name_mismatch":
        return "Email Match, Name Different";
      case "phone_name_mismatch":
        return "Phone Match, Name Different";
      default:
        return type;
    }
  };

  const formatConfidence = (score: number) => {
    if (score >= 0.9) return { label: "High", color: "#198754" };
    if (score >= 0.7) return { label: "Medium", color: "#fd7e14" };
    return { label: "Low", color: "#dc3545" };
  };

  return (
    <div>
      <h1 style={{ marginBottom: "0.5rem" }}>Potential Duplicate People</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Review people who were flagged because they share an email or phone with someone else but have a different name.
      </p>

      {data?.note && (
        <div style={{
          padding: "1rem",
          background: "#fff3cd",
          border: "1px solid #ffc107",
          borderRadius: "6px",
          marginBottom: "1.5rem"
        }}>
          {data.note}
        </div>
      )}

      {/* Status tabs */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
        {[
          { key: "pending", label: "Pending Review", count: data?.counts.pending },
          { key: "merged", label: "Merged", count: data?.counts.merged },
          { key: "kept_separate", label: "Kept Separate", count: data?.counts.kept_separate },
          { key: "dismissed", label: "Dismissed", count: data?.counts.dismissed },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatus(tab.key)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: status === tab.key ? "var(--accent, #0d6efd)" : "transparent",
              color: status === tab.key ? "#fff" : "var(--foreground)",
              cursor: "pointer",
            }}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span style={{
                marginLeft: "0.5rem",
                background: status === tab.key ? "rgba(255,255,255,0.2)" : "var(--bg-muted)",
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                fontSize: "0.8rem",
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <div className="loading">Loading...</div>}

      {!loading && data?.duplicates.length === 0 && (
        <div className="empty">
          No {status === "pending" ? "pending duplicates to review" : `${status.replace("_", " ")} records`}.
        </div>
      )}

      {!loading && data?.duplicates.map((dup) => {
        const newConf = formatConfidence(dup.new_confidence);
        const existConf = formatConfidence(dup.existing_confidence);

        return (
          <div
            key={dup.duplicate_id}
            className="card"
            style={{ padding: "1.5rem", marginBottom: "1rem" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
              <div>
                <span style={{
                  fontSize: "0.75rem",
                  padding: "0.2rem 0.5rem",
                  background: "#ffc107",
                  color: "#000",
                  borderRadius: "4px",
                  marginRight: "0.5rem",
                }}>
                  {formatMatchType(dup.match_type)}
                </span>
                <span className="text-muted text-sm">
                  Shared: {dup.matched_identifier}
                </span>
              </div>
              <span className="text-muted text-sm">
                {new Date(dup.created_at).toLocaleDateString()}
              </span>
            </div>

            {/* Comparison cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "1rem", alignItems: "center" }}>
              {/* New person */}
              <div style={{
                padding: "1rem",
                background: "rgba(25, 135, 84, 0.1)",
                borderRadius: "8px",
                border: "1px solid rgba(25, 135, 84, 0.3)",
              }}>
                <div style={{ fontWeight: 600, fontSize: "1.1rem", marginBottom: "0.5rem" }}>
                  <a href={`/people/${dup.new_person_id}`}>{dup.new_name}</a>
                </div>
                <div style={{ display: "flex", gap: "1rem", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                  <span>
                    <strong>{dup.new_person_requests}</strong> requests
                  </span>
                  <span>
                    <strong>{dup.new_person_submissions}</strong> submissions
                  </span>
                </div>
                <div style={{ fontSize: "0.8rem" }}>
                  Source: <span style={{ fontWeight: 500 }}>{dup.new_source_system}</span>
                  <span style={{ marginLeft: "0.5rem", color: newConf.color }}>
                    ({newConf.label} confidence)
                  </span>
                </div>
              </div>

              {/* Similarity indicator */}
              <div style={{ textAlign: "center" }}>
                <div style={{
                  fontSize: "1.5rem",
                  fontWeight: 600,
                  color: dup.name_similarity > 0.5 ? "#198754" : "#dc3545",
                }}>
                  {Math.round(dup.name_similarity * 100)}%
                </div>
                <div className="text-muted text-sm">name match</div>
              </div>

              {/* Existing person */}
              <div style={{
                padding: "1rem",
                background: "rgba(108, 117, 125, 0.1)",
                borderRadius: "8px",
                border: "1px solid rgba(108, 117, 125, 0.3)",
              }}>
                <div style={{ fontWeight: 600, fontSize: "1.1rem", marginBottom: "0.5rem" }}>
                  <a href={`/people/${dup.existing_person_id}`}>{dup.existing_name}</a>
                </div>
                <div style={{ display: "flex", gap: "1rem", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                  <span>
                    <strong>{dup.existing_person_requests}</strong> requests
                  </span>
                  <span>
                    <strong>{dup.existing_person_submissions}</strong> submissions
                  </span>
                </div>
                <div style={{ fontSize: "0.8rem" }}>
                  Source: <span style={{ fontWeight: 500 }}>{dup.existing_source_system}</span>
                  <span style={{ marginLeft: "0.5rem", color: existConf.color }}>
                    ({existConf.label} confidence)
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            {status === "pending" && (
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end" }}>
                <button
                  onClick={() => handleResolve(dup.duplicate_id, "keep_separate")}
                  disabled={resolving === dup.duplicate_id}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#198754",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Different People
                </button>
                <button
                  onClick={() => handleResolve(dup.duplicate_id, "merge")}
                  disabled={resolving === dup.duplicate_id}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#fd7e14",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Merge (Same Person)
                </button>
                <button
                  onClick={() => handleResolve(dup.duplicate_id, "dismiss")}
                  disabled={resolving === dup.duplicate_id}
                  style={{
                    padding: "0.5rem 1rem",
                    background: "#6c757d",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
