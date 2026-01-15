"use client";

import { useState, useEffect, useCallback } from "react";

interface EcologyConfig {
  config_id: string;
  config_key: string;
  config_value: number;
  unit: string;
  description: string;
  min_value: number;
  max_value: number;
  updated_at: string;
  updated_by: string | null;
}

interface ConfigAudit {
  audit_id: string;
  config_key: string;
  old_value: number;
  new_value: number;
  changed_by: string;
  change_reason: string | null;
  changed_at: string;
}

export default function EcologyConfigPage() {
  const [configs, setConfigs] = useState<EcologyConfig[]>([]);
  const [audits, setAudits] = useState<ConfigAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<number>(0);
  const [editReason, setEditReason] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configRes, auditRes] = await Promise.all([
        fetch("/api/admin/ecology-config"),
        fetch("/api/admin/ecology-config/audit"),
      ]);

      if (!configRes.ok) throw new Error("Failed to fetch config");

      const configData = await configRes.json();
      const auditData = auditRes.ok ? await auditRes.json() : { audits: [] };

      setConfigs(configData.configs || []);
      setAudits(auditData.audits || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const startEdit = (config: EcologyConfig) => {
    setEditingKey(config.config_key);
    setEditValue(config.config_value);
    setEditReason("");
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditValue(0);
    setEditReason("");
  };

  const saveConfig = async () => {
    if (!editingKey) return;

    setSaving(true);
    try {
      const response = await fetch("/api/admin/ecology-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config_key: editingKey,
          config_value: editValue,
          reason: editReason || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to update config");
      }

      cancelEdit();
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  const formatConfigKey = (key: string) => {
    return key
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const getCategoryForKey = (key: string): string => {
    if (key.includes("lifespan") || key.includes("revisit")) return "Cat Lifespan";
    if (key.includes("window") || key.includes("days")) return "Reporting Windows";
    if (key.includes("threshold") || key.includes("colony")) return "Colony Status";
    return "Other";
  };

  // Group configs by category
  const groupedConfigs = configs.reduce(
    (acc, config) => {
      const category = getCategoryForKey(config.config_key);
      if (!acc[category]) acc[category] = [];
      acc[category].push(config);
      return acc;
    },
    {} as Record<string, EcologyConfig[]>
  );

  if (loading) {
    return <div className="loading">Loading ecology configuration...</div>;
  }

  return (
    <div>
      <h1 style={{ marginBottom: "0.5rem" }}>Ecology Configuration</h1>
      <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
        Configure parameters used in colony size and alteration rate calculations.
        All changes are audited.
      </p>

      {error && (
        <div className="empty" style={{ color: "red", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {Object.entries(groupedConfigs).map(([category, categoryConfigs]) => (
        <div key={category} style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "1rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "0.5rem" }}>
            {category}
          </h2>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Value</th>
                  <th>Range</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categoryConfigs.map((config) => (
                  <tr key={config.config_key}>
                    <td>
                      <strong>{formatConfigKey(config.config_key)}</strong>
                    </td>
                    <td>
                      {editingKey === config.config_key ? (
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(Number(e.target.value))}
                          min={config.min_value}
                          max={config.max_value}
                          style={{ width: "80px" }}
                        />
                      ) : (
                        <span>
                          {config.config_value} {config.unit}
                        </span>
                      )}
                    </td>
                    <td className="text-muted text-sm">
                      {config.min_value} - {config.max_value}
                    </td>
                    <td className="text-sm">{config.description}</td>
                    <td>
                      {editingKey === config.config_key ? (
                        <div style={{ display: "flex", gap: "0.5rem", flexDirection: "column" }}>
                          <input
                            type="text"
                            placeholder="Reason for change..."
                            value={editReason}
                            onChange={(e) => setEditReason(e.target.value)}
                            style={{ fontSize: "0.85rem" }}
                          />
                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button
                              onClick={saveConfig}
                              disabled={saving}
                              className="btn-primary"
                              style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem" }}
                            >
                              {saving ? "Saving..." : "Save"}
                            </button>
                            <button
                              onClick={cancelEdit}
                              style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem" }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(config)}
                          style={{ fontSize: "0.85rem", padding: "0.25rem 0.5rem" }}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <h2 style={{ fontSize: "1.1rem", marginTop: "2rem", marginBottom: "1rem" }}>
        Recent Changes
      </h2>

      {audits.length === 0 ? (
        <p className="text-muted">No configuration changes recorded yet.</p>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Old Value</th>
                <th>New Value</th>
                <th>Changed By</th>
                <th>Reason</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {audits.slice(0, 20).map((audit) => (
                <tr key={audit.audit_id}>
                  <td>{formatConfigKey(audit.config_key)}</td>
                  <td>{audit.old_value}</td>
                  <td>{audit.new_value}</td>
                  <td>{audit.changed_by}</td>
                  <td className="text-sm">{audit.change_reason || "—"}</td>
                  <td className="text-sm">
                    {new Date(audit.changed_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
