"use client";

import { useState, useEffect } from "react";
import { TrapperBadge } from "./TrapperBadge";

interface TrapperAssignment {
  assignment_id: string;
  trapper_person_id: string;
  trapper_name: string;
  trapper_type: string;
  is_ffsc_trapper: boolean;
  is_primary: boolean;
  assigned_at: string;
  assignment_reason: string | null;
}

interface AssignmentHistory {
  trapper_person_id: string;
  trapper_name: string;
  is_primary: boolean;
  assigned_at: string;
  unassigned_at: string | null;
  assignment_reason: string | null;
  unassignment_reason: string | null;
  status: string;
}

interface Props {
  requestId: string;
  compact?: boolean;
}

export function TrapperAssignments({ requestId, compact = false }: Props) {
  const [trappers, setTrappers] = useState<TrapperAssignment[]>([]);
  const [history, setHistory] = useState<AssignmentHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    async function fetchTrappers() {
      try {
        const response = await fetch(
          `/api/requests/${requestId}/trappers?history=true`
        );
        if (response.ok) {
          const data = await response.json();
          setTrappers(data.trappers || []);
          setHistory(data.history || []);
        }
      } catch (err) {
        console.error("Failed to fetch trappers:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchTrappers();
  }, [requestId]);

  if (loading) {
    return <span className="text-muted">Loading...</span>;
  }

  if (trappers.length === 0) {
    return <span className="text-muted">No trappers assigned</span>;
  }

  // Compact mode: just show names inline
  if (compact) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        {trappers.map((t, i) => (
          <span key={t.assignment_id}>
            <a href={`/trappers/${t.trapper_person_id}`} style={{ fontWeight: t.is_primary ? 600 : 400 }}>
              {t.trapper_name}
            </a>
            {t.is_primary && (
              <span style={{ fontSize: "0.7rem", color: "#0d6efd", marginLeft: "0.25rem" }}>
                (lead)
              </span>
            )}
            {i < trappers.length - 1 && ", "}
          </span>
        ))}
        {trappers.length > 1 && (
          <span className="text-muted text-sm" style={{ marginLeft: "0.25rem" }}>
            ({trappers.length} trappers)
          </span>
        )}
      </div>
    );
  }

  // Full mode: show cards with details
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {trappers.map((t) => (
          <div
            key={t.assignment_id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.75rem",
              background: t.is_primary ? "rgba(13, 110, 253, 0.05)" : "#f8f9fa",
              borderRadius: "6px",
              border: t.is_primary ? "1px solid rgba(13, 110, 253, 0.2)" : "1px solid transparent",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <a
                  href={`/trappers/${t.trapper_person_id}`}
                  style={{ fontWeight: 600, fontSize: "0.95rem" }}
                >
                  {t.trapper_name}
                </a>
                <TrapperBadge trapperType={t.trapper_type} size="sm" />
                {t.is_primary && (
                  <span
                    style={{
                      fontSize: "0.65rem",
                      padding: "0.15rem 0.4rem",
                      background: "#0d6efd",
                      color: "#fff",
                      borderRadius: "3px",
                      fontWeight: 600,
                    }}
                  >
                    LEAD
                  </span>
                )}
              </div>
              <div className="text-muted text-sm" style={{ marginTop: "0.25rem" }}>
                Assigned {new Date(t.assigned_at).toLocaleDateString()}
                {t.assignment_reason && t.assignment_reason !== "airtable_sync" && (
                  <span> - {t.assignment_reason}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* History toggle */}
      {history.length > trappers.length && (
        <div style={{ marginTop: "1rem" }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              background: "transparent",
              border: "none",
              color: "#0d6efd",
              fontSize: "0.8rem",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {showHistory ? "Hide history" : `Show assignment history (${history.length} total)`}
          </button>

          {showHistory && (
            <div style={{ marginTop: "0.75rem" }}>
              <table className="data-table" style={{ fontSize: "0.8rem" }}>
                <thead>
                  <tr>
                    <th>Trapper</th>
                    <th>Assigned</th>
                    <th>Unassigned</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={`${h.trapper_person_id}-${h.assigned_at}-${i}`}>
                      <td>
                        <a href={`/trappers/${h.trapper_person_id}`}>{h.trapper_name}</a>
                        {h.is_primary && " (lead)"}
                      </td>
                      <td>{new Date(h.assigned_at).toLocaleDateString()}</td>
                      <td>
                        {h.unassigned_at
                          ? new Date(h.unassigned_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td>
                        <span
                          style={{
                            color: h.status === "active" ? "#198754" : "#6c757d",
                          }}
                        >
                          {h.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
