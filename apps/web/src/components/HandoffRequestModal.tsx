"use client";

import { useState, useEffect } from "react";

interface HandoffRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestId: string;
  originalSummary: string;
  originalAddress: string | null;
  originalRequesterName: string | null;
  onSuccess?: (newRequestId: string) => void;
}

const HANDOFF_REASONS = [
  { value: "caretaker_moving", label: "Original caretaker is moving" },
  { value: "new_caretaker", label: "New person taking over colony care" },
  { value: "cats_relocated", label: "Cats are being relocated to new site" },
  { value: "neighbor_takeover", label: "Neighbor assuming responsibility" },
  { value: "health_reasons", label: "Original caretaker cannot continue (health/personal)" },
  { value: "other", label: "Other reason" },
];

export function HandoffRequestModal({
  isOpen,
  onClose,
  requestId,
  originalSummary,
  originalAddress,
  originalRequesterName,
  onSuccess,
}: HandoffRequestModalProps) {
  const [handoffReason, setHandoffReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newRequesterName, setNewRequesterName] = useState("");
  const [newRequesterPhone, setNewRequesterPhone] = useState("");
  const [newRequesterEmail, setNewRequesterEmail] = useState("");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [estimatedCatCount, setEstimatedCatCount] = useState<number | "">("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setHandoffReason("");
      setCustomReason("");
      setNewAddress("");
      setNewRequesterName("");
      setNewRequesterPhone("");
      setNewRequesterEmail("");
      setSummary("");
      setNotes("");
      setEstimatedCatCount("");
      setError("");
      setSuccess(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validation
    if (!handoffReason) {
      setError("Please select a handoff reason");
      return;
    }

    if (handoffReason === "other" && !customReason.trim()) {
      setError("Please provide a custom reason");
      return;
    }

    if (!newAddress.trim()) {
      setError("Please enter the new caretaker's address");
      return;
    }

    if (!newRequesterName.trim()) {
      setError("Please enter the new caretaker's name");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/requests/${requestId}/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handoff_reason:
            handoffReason === "other"
              ? customReason
              : HANDOFF_REASONS.find((r) => r.value === handoffReason)?.label,
          new_address: newAddress,
          new_requester_name: newRequesterName,
          new_requester_phone: newRequesterPhone || null,
          new_requester_email: newRequesterEmail || null,
          summary: summary || null,
          notes: notes || null,
          estimated_cat_count: estimatedCatCount === "" ? null : estimatedCatCount,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to hand off request");
      }

      setSuccess(true);
      setTimeout(() => {
        onClose();
        onSuccess?.(data.new_request_id);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to hand off request");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "550px",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)",
            borderRadius: "12px 12px 0 0",
            color: "#fff",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600 }}>
              Hand Off Request
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: "0.85rem", opacity: 0.9 }}>
              Transfer responsibility to a new caretaker
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.2)",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "#fff",
              lineHeight: 1,
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            &times;
          </button>
        </div>

        {/* Original Request Info */}
        <div
          style={{
            padding: "12px 24px",
            background: "var(--section-bg, #f8f9fa)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "4px" }}>
            Current Request
          </div>
          <div style={{ fontSize: "0.9rem" }}>
            {originalSummary || "No summary"}
          </div>
          {originalAddress && (
            <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "2px" }}>
              {originalAddress}
            </div>
          )}
          {originalRequesterName && (
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
              Current caretaker: {originalRequesterName}
            </div>
          )}
        </div>

        {/* Info Banner */}
        <div
          style={{
            padding: "12px 24px",
            background: "#f0fdfa",
            borderBottom: "1px solid #99f6e4",
            fontSize: "0.85rem",
            color: "#0f766e",
          }}
        >
          <strong>Note:</strong> This will close the current request and create a new one
          for the new caretaker. Both requests will be linked together.
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: "20px 24px" }}>
          {/* Handoff Reason */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Why is this being handed off? *
            </label>
            <select
              value={handoffReason}
              onChange={(e) => setHandoffReason(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                background: "var(--input-bg, #fff)",
              }}
            >
              <option value="">Select a reason...</option>
              {HANDOFF_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom reason if "other" selected */}
          {handoffReason === "other" && (
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                Describe the reason *
              </label>
              <input
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Enter the handoff reason"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--input-bg, #fff)",
                }}
              />
            </div>
          )}

          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "20px 0" }} />

          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "16px", color: "#0d9488" }}>
            New Caretaker Details
          </h3>

          {/* New Caretaker Name */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              New Caretaker Name *
            </label>
            <input
              type="text"
              value={newRequesterName}
              onChange={(e) => setNewRequesterName(e.target.value)}
              placeholder="Name of person taking over"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                background: "var(--input-bg, #fff)",
              }}
            />
          </div>

          {/* New Address */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              New Location/Address *
            </label>
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="Address where cats will be cared for"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                background: "var(--input-bg, #fff)",
              }}
            />
          </div>

          {/* Contact Info */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                Phone
              </label>
              <input
                type="tel"
                value={newRequesterPhone}
                onChange={(e) => setNewRequesterPhone(e.target.value)}
                placeholder="Phone number"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--input-bg, #fff)",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                Email
              </label>
              <input
                type="email"
                value={newRequesterEmail}
                onChange={(e) => setNewRequesterEmail(e.target.value)}
                placeholder="Email address"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--input-bg, #fff)",
                }}
              />
            </div>
          </div>

          {/* Cat Count & Summary */}
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "12px", marginBottom: "16px" }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                Est. Cats
              </label>
              <input
                type="number"
                min="0"
                value={estimatedCatCount}
                onChange={(e) =>
                  setEstimatedCatCount(e.target.value === "" ? "" : parseInt(e.target.value))
                }
                placeholder="#"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--input-bg, #fff)",
                }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  marginBottom: "6px",
                }}
              >
                Summary
              </label>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Brief summary for new request"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  background: "var(--input-bg, #fff)",
                }}
              />
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 500,
                marginBottom: "6px",
              }}
            >
              Additional Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional context about the handoff..."
              rows={3}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "0.9rem",
                background: "var(--input-bg, #fff)",
                resize: "vertical",
              }}
            />
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div
              style={{
                padding: "10px 14px",
                background: "#fee2e2",
                color: "#b91c1c",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "0.9rem",
              }}
            >
              {error}
            </div>
          )}

          {success && (
            <div
              style={{
                padding: "10px 14px",
                background: "#d1fae5",
                color: "#065f46",
                borderRadius: "8px",
                marginBottom: "16px",
                fontSize: "0.9rem",
              }}
            >
              Request handed off successfully! Redirecting to new request...
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: "10px 20px",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                background: "transparent",
                cursor: "pointer",
                fontSize: "0.9rem",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || success}
              style={{
                padding: "10px 20px",
                border: "none",
                borderRadius: "8px",
                background: "#0d9488",
                color: "#fff",
                cursor: "pointer",
                fontSize: "0.9rem",
                opacity: isSubmitting || success ? 0.7 : 1,
              }}
            >
              {isSubmitting ? "Handing Off..." : "Hand Off to New Caretaker"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
