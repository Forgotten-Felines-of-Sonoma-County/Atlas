"use client";

import { useState, useEffect } from "react";

interface KnownOrganization {
  org_id: string;
  canonical_name: string;
  short_name: string | null;
  aliases: string[];
  org_type: string;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
  service_area: string | null;
  name_patterns: string[];
  email_domains: string[];
  match_priority: number;
  auto_link: boolean;
  canonical_person_id: string | null;
  canonical_place_id: string | null;
  notes: string | null;
  is_active: boolean;
  person_display_name: string | null;
  matching_person_count: number;
  matches_24h: number;
  matches_7d: number;
  matches_total: number;
}

interface OrgStats {
  total_orgs: number;
  active_orgs: number;
  linked_orgs: number;
  matches_24h: number;
  pending_review: number;
}

interface OrgType {
  org_type: string;
  count: number;
}

interface MatchLogEntry {
  log_id: string;
  matched_value: string;
  match_type: string;
  confidence: number;
  decision: string;
  created_at: string;
  source_system: string;
}

const ORG_TYPES = [
  { value: "shelter", label: "Shelter" },
  { value: "rescue", label: "Rescue" },
  { value: "clinic", label: "Clinic" },
  { value: "municipal", label: "Municipal" },
  { value: "partner", label: "Partner" },
  { value: "other", label: "Other" },
];

const MATCH_PRIORITIES = [
  { value: 10, label: "10 - Highest (County)" },
  { value: 20, label: "20 - Municipal" },
  { value: 30, label: "30 - Clinic" },
  { value: 50, label: "50 - Rescue" },
  { value: 100, label: "100 - Default" },
];

export default function KnownOrganizationsPage() {
  const [orgs, setOrgs] = useState<KnownOrganization[]>([]);
  const [stats, setStats] = useState<OrgStats | null>(null);
  const [orgTypes, setOrgTypes] = useState<OrgType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<KnownOrganization | null>(null);
  const [showMatchesModal, setShowMatchesModal] = useState<string | null>(null);
  const [matchesData, setMatchesData] = useState<{
    matches: MatchLogEntry[];
    stats: { total_matches: number; linked_count: number };
  } | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [filterType, setFilterType] = useState<string>("");

  // Form state
  const [form, setForm] = useState({
    canonical_name: "",
    short_name: "",
    aliases: [] as string[],
    org_type: "other",
    street_address: "",
    city: "",
    state: "CA",
    zip: "",
    phone: "",
    email: "",
    website: "",
    lat: "",
    lng: "",
    service_area: "",
    name_patterns: [] as string[],
    email_domains: [] as string[],
    match_priority: 100,
    auto_link: true,
    notes: "",
  });
  const [newAlias, setNewAlias] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newDomain, setNewDomain] = useState("");

  const fetchOrgs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (includeInactive) params.set("include_inactive", "true");
      if (filterType) params.set("org_type", filterType);

      const response = await fetch(`/api/admin/known-organizations?${params}`);
      const data = await response.json();
      setOrgs(data.organizations || []);
      setStats(data.stats || null);
      setOrgTypes(data.org_types || []);
    } catch (err) {
      console.error("Failed to fetch organizations:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrgs();
  }, [includeInactive, filterType]);

  const resetForm = () => {
    setForm({
      canonical_name: "",
      short_name: "",
      aliases: [],
      org_type: "other",
      street_address: "",
      city: "",
      state: "CA",
      zip: "",
      phone: "",
      email: "",
      website: "",
      lat: "",
      lng: "",
      service_area: "",
      name_patterns: [],
      email_domains: [],
      match_priority: 100,
      auto_link: true,
      notes: "",
    });
    setNewAlias("");
    setNewPattern("");
    setNewDomain("");
  };

  const openAddModal = () => {
    resetForm();
    setEditingOrg(null);
    setShowAddModal(true);
  };

  const openEditModal = (org: KnownOrganization) => {
    setEditingOrg(org);
    setForm({
      canonical_name: org.canonical_name,
      short_name: org.short_name || "",
      aliases: org.aliases || [],
      org_type: org.org_type,
      street_address: org.street_address || "",
      city: org.city || "",
      state: org.state || "CA",
      zip: org.zip || "",
      phone: org.phone || "",
      email: org.email || "",
      website: org.website || "",
      lat: org.lat?.toString() || "",
      lng: org.lng?.toString() || "",
      service_area: org.service_area || "",
      name_patterns: org.name_patterns || [],
      email_domains: org.email_domains || [],
      match_priority: org.match_priority || 100,
      auto_link: org.auto_link !== false,
      notes: org.notes || "",
    });
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingOrg(null);
    resetForm();
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const url = editingOrg
        ? `/api/admin/known-organizations/${editingOrg.org_id}`
        : "/api/admin/known-organizations";
      const method = editingOrg ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          lat: form.lat ? parseFloat(form.lat) : null,
          lng: form.lng ? parseFloat(form.lng) : null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save");
      }

      setMessage({ type: "success", text: editingOrg ? "Organization updated!" : "Organization created!" });
      closeModal();
      fetchOrgs();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (org: KnownOrganization) => {
    if (!confirm(`Deactivate "${org.canonical_name}"? This will prevent future matching.`)) return;

    try {
      const response = await fetch(`/api/admin/known-organizations/${org.org_id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to deactivate");

      setMessage({ type: "success", text: "Organization deactivated" });
      fetchOrgs();
    } catch {
      setMessage({ type: "error", text: "Failed to deactivate organization" });
    }
  };

  const handleMerge = async (org: KnownOrganization, dryRun: boolean) => {
    setMerging(org.org_id);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/known-organizations/${org.org_id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Merge failed");

      if (dryRun) {
        const results = data.results || [];
        const foundResult = results.find((r: { action: string }) => r.action === "found" || r.action === "dry_run");
        if (foundResult) {
          const count = foundResult.details?.duplicate_count || foundResult.details?.would_merge?.length || 0;
          if (count > 1 && confirm(`Found ${count} matching records. Merge them into one?`)) {
            handleMerge(org, false);
          } else if (count <= 1) {
            setMessage({ type: "success", text: "No duplicates to merge" });
          }
        } else {
          setMessage({ type: "success", text: "No duplicates found" });
        }
      } else {
        const mergedResult = data.results?.find((r: { action: string }) => r.action === "merged");
        const count = mergedResult?.details?.merged_count || 0;
        setMessage({ type: "success", text: `Merged ${count} duplicate records` });
        fetchOrgs();
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Merge failed" });
    } finally {
      setMerging(null);
    }
  };

  const viewMatches = async (org: KnownOrganization) => {
    setShowMatchesModal(org.org_id);
    setMatchesData(null);

    try {
      const response = await fetch(`/api/admin/known-organizations/${org.org_id}/matches?limit=20`);
      const data = await response.json();
      setMatchesData(data);
    } catch (err) {
      console.error("Failed to fetch matches:", err);
    }
  };

  const addItem = (field: "aliases" | "name_patterns" | "email_domains", value: string, setter: (v: string) => void) => {
    if (value.trim()) {
      setForm(f => ({
        ...f,
        [field]: [...f[field], value.trim()],
      }));
      setter("");
    }
  };

  const removeItem = (field: "aliases" | "name_patterns" | "email_domains", index: number) => {
    setForm(f => ({
      ...f,
      [field]: f[field].filter((_, i) => i !== index),
    }));
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>Known Organizations</h1>
          <p style={{ color: "var(--muted)", margin: "0.25rem 0 0" }}>
            Manage animal welfare organizations for identity matching
          </p>
        </div>
        <button
          onClick={openAddModal}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--foreground)",
            color: "var(--background)",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          + Add Organization
        </button>
      </div>

      {/* Message */}
      {message && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "6px",
            marginBottom: "1rem",
            background: message.type === "success" ? "rgba(25, 135, 84, 0.15)" : "rgba(220, 53, 69, 0.15)",
            color: message.type === "success" ? "#198754" : "#dc3545",
          }}
        >
          {message.text}
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 600 }}>{stats.active_orgs}</div>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Organizations</div>
          </div>
          <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 600 }}>{stats.linked_orgs}</div>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Linked</div>
          </div>
          <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 600 }}>{stats.matches_24h}</div>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Matches (24h)</div>
          </div>
          <div style={{ background: "var(--card-bg, rgba(0,0,0,0.05))", borderRadius: "8px", padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "1.75rem", fontWeight: 600, color: stats.pending_review > 0 ? "#ffc107" : undefined }}>
              {stats.pending_review}
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Pending Review</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center" }}>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{ padding: "0.5rem", borderRadius: "4px", border: "1px solid var(--border)" }}
        >
          <option value="">All Types</option>
          {orgTypes.map(t => (
            <option key={t.org_type} value={t.org_type}>
              {ORG_TYPES.find(ot => ot.value === t.org_type)?.label || t.org_type} ({t.count})
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Show Inactive
        </label>
      </div>

      {/* Organizations Table */}
      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>Loading...</div>
      ) : orgs.length === 0 ? (
        <div
          style={{
            padding: "3rem",
            textAlign: "center",
            background: "var(--card-bg, rgba(0,0,0,0.05))",
            borderRadius: "8px",
          }}
        >
          <p style={{ fontSize: "1.1rem", margin: "0 0 0.5rem" }}>No organizations found</p>
          <p style={{ color: "var(--muted)", margin: "0 0 1rem" }}>
            Add known organizations to prevent duplicates during imports.
          </p>
          <button
            onClick={openAddModal}
            style={{
              padding: "0.5rem 1rem",
              background: "var(--foreground)",
              color: "var(--background)",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Add Organization
          </button>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "0.75rem 0.5rem" }}>Organization</th>
                <th style={{ textAlign: "left", padding: "0.75rem 0.5rem" }}>Type</th>
                <th style={{ textAlign: "center", padding: "0.75rem 0.5rem" }}>Linked</th>
                <th style={{ textAlign: "right", padding: "0.75rem 0.5rem" }}>Matches</th>
                <th style={{ textAlign: "right", padding: "0.75rem 0.5rem" }}>Duplicates</th>
                <th style={{ textAlign: "right", padding: "0.75rem 0.5rem" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr
                  key={org.org_id}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    opacity: org.is_active ? 1 : 0.5,
                  }}
                >
                  <td style={{ padding: "0.75rem 0.5rem" }}>
                    <div style={{ fontWeight: 500 }}>{org.canonical_name}</div>
                    {org.short_name && (
                      <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{org.short_name}</div>
                    )}
                    {org.city && (
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{org.city}</div>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "0.8rem",
                        background:
                          org.org_type === "shelter" ? "rgba(25, 135, 84, 0.15)" :
                          org.org_type === "rescue" ? "rgba(13, 110, 253, 0.15)" :
                          org.org_type === "clinic" ? "rgba(111, 66, 193, 0.15)" :
                          org.org_type === "municipal" ? "rgba(255, 193, 7, 0.15)" :
                          "rgba(128, 128, 128, 0.15)",
                        color:
                          org.org_type === "shelter" ? "#198754" :
                          org.org_type === "rescue" ? "#0d6efd" :
                          org.org_type === "clinic" ? "#6f42c1" :
                          org.org_type === "municipal" ? "#b38600" :
                          "inherit",
                      }}
                    >
                      {ORG_TYPES.find(t => t.value === org.org_type)?.label || org.org_type}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "center" }}>
                    {org.canonical_person_id ? (
                      <span style={{ color: "#198754" }}>Yes</span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>No</span>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}>
                    <button
                      onClick={() => viewMatches(org)}
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        textDecoration: "underline",
                        color: org.matches_24h > 0 ? "#0d6efd" : "var(--muted)",
                      }}
                    >
                      {org.matches_24h > 0 ? `${org.matches_24h} (24h)` : org.matches_total || 0}
                    </button>
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}>
                    {org.matching_person_count > 1 ? (
                      <span style={{ color: "#ffc107", fontWeight: 500 }}>{org.matching_person_count}</span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>0</span>
                    )}
                  </td>
                  <td style={{ padding: "0.75rem 0.5rem", textAlign: "right" }}>
                    <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
                      <button
                        onClick={() => openEditModal(org)}
                        style={{
                          padding: "0.25rem 0.5rem",
                          background: "transparent",
                          border: "1px solid var(--border)",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "0.8rem",
                        }}
                      >
                        Edit
                      </button>
                      {org.matching_person_count > 1 && (
                        <button
                          onClick={() => handleMerge(org, true)}
                          disabled={merging === org.org_id}
                          style={{
                            padding: "0.25rem 0.5rem",
                            background: "#ffc107",
                            color: "#000",
                            border: "none",
                            borderRadius: "4px",
                            cursor: merging === org.org_id ? "not-allowed" : "pointer",
                            fontSize: "0.8rem",
                            opacity: merging === org.org_id ? 0.7 : 1,
                          }}
                        >
                          {merging === org.org_id ? "..." : "Merge"}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(org)}
                        style={{
                          padding: "0.25rem 0.5rem",
                          background: "transparent",
                          border: "1px solid #dc3545",
                          color: "#dc3545",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "0.8rem",
                        }}
                      >
                        Deactivate
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeModal}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "650px",
              width: "90%",
              maxHeight: "85vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem" }}>
              {editingOrg ? "Edit Organization" : "Add Organization"}
            </h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              {/* Canonical Name */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Canonical Name *
                </label>
                <input
                  type="text"
                  value={form.canonical_name}
                  onChange={(e) => setForm({ ...form, canonical_name: e.target.value })}
                  placeholder="e.g., Sonoma County Animal Services"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              {/* Short Name */}
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Short Name
                </label>
                <input
                  type="text"
                  value={form.short_name}
                  onChange={(e) => setForm({ ...form, short_name: e.target.value })}
                  placeholder="e.g., SCAS"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              {/* Org Type */}
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Organization Type *
                </label>
                <select
                  value={form.org_type}
                  onChange={(e) => setForm({ ...form, org_type: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem" }}
                >
                  {ORG_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Aliases */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Aliases
                </label>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <input
                    type="text"
                    value={newAlias}
                    onChange={(e) => setNewAlias(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addItem("aliases", newAlias, setNewAlias))}
                    placeholder="Add an alias..."
                    style={{ flex: 1, padding: "0.5rem" }}
                  />
                  <button
                    type="button"
                    onClick={() => addItem("aliases", newAlias, setNewAlias)}
                    style={{
                      padding: "0.5rem 1rem",
                      background: "var(--foreground)",
                      color: "var(--background)",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Add
                  </button>
                </div>
                {form.aliases.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {form.aliases.map((alias, i) => (
                      <span
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          padding: "0.25rem 0.5rem",
                          background: "var(--card-bg, rgba(0,0,0,0.1))",
                          borderRadius: "4px",
                          fontSize: "0.85rem",
                        }}
                      >
                        {alias}
                        <button
                          type="button"
                          onClick={() => removeItem("aliases", i)}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            padding: "0",
                            color: "#dc3545",
                            fontSize: "1rem",
                            lineHeight: 1,
                          }}
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Address fields */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Street Address
                </label>
                <input
                  type="text"
                  value={form.street_address}
                  onChange={(e) => setForm({ ...form, street_address: e.target.value })}
                  placeholder="e.g., 1247 Century Ct"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  placeholder="e.g., Santa Rosa"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>State</label>
                  <input
                    type="text"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>ZIP</label>
                  <input
                    type="text"
                    value={form.zip}
                    onChange={(e) => setForm({ ...form, zip: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem" }}
                  />
                </div>
              </div>

              {/* Contact */}
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>Phone</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="e.g., 707-565-7100"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="e.g., info@example.org"
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>Website</label>
                <input
                  type="url"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                  placeholder="https://..."
                  style={{ width: "100%", padding: "0.5rem" }}
                />
              </div>

              {/* Email Domains */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Email Domains (for matching)
                </label>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <input
                    type="text"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addItem("email_domains", newDomain, setNewDomain))}
                    placeholder="e.g., sonomacounty.gov"
                    style={{ flex: 1, padding: "0.5rem" }}
                  />
                  <button
                    type="button"
                    onClick={() => addItem("email_domains", newDomain, setNewDomain)}
                    style={{
                      padding: "0.5rem 1rem",
                      background: "var(--foreground)",
                      color: "var(--background)",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Add
                  </button>
                </div>
                {form.email_domains.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {form.email_domains.map((domain, i) => (
                      <span
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.25rem",
                          padding: "0.25rem 0.5rem",
                          background: "rgba(13, 110, 253, 0.15)",
                          borderRadius: "4px",
                          fontSize: "0.85rem",
                        }}
                      >
                        @{domain}
                        <button
                          type="button"
                          onClick={() => removeItem("email_domains", i)}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            padding: "0",
                            color: "#dc3545",
                            fontSize: "1rem",
                            lineHeight: 1,
                          }}
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                  Emails from these domains will match this organization
                </p>
              </div>

              {/* Match Priority */}
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>
                  Match Priority
                </label>
                <select
                  value={form.match_priority}
                  onChange={(e) => setForm({ ...form, match_priority: parseInt(e.target.value) })}
                  style={{ width: "100%", padding: "0.5rem" }}
                >
                  {MATCH_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                  Lower = checked first when matching
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", paddingTop: "1.5rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.auto_link}
                    onChange={(e) => setForm({ ...form, auto_link: e.target.checked })}
                  />
                  <span>Auto-link matches</span>
                </label>
              </div>

              {/* Notes */}
              <div style={{ gridColumn: "span 2" }}>
                <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem" }}>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Additional notes about this organization..."
                  rows={2}
                  style={{ width: "100%", padding: "0.5rem", resize: "vertical" }}
                />
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem", justifyContent: "flex-end" }}>
              <button
                onClick={closeModal}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.canonical_name}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#198754",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving || !form.canonical_name ? 0.7 : 1,
                }}
              >
                {saving ? "Saving..." : editingOrg ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Matches Modal */}
      {showMatchesModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowMatchesModal(null)}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "600px",
              width: "90%",
              maxHeight: "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 1rem" }}>Match History</h2>

            {!matchesData ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>Loading...</div>
            ) : matchesData.matches.length === 0 ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
                No matches recorded yet
              </div>
            ) : (
              <>
                <div style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "var(--muted)" }}>
                  Total: {matchesData.stats.total_matches} matches ({matchesData.stats.linked_count} linked)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {matchesData.matches.map((match) => (
                    <div
                      key={match.log_id}
                      style={{
                        padding: "0.75rem",
                        background: "var(--card-bg, rgba(0,0,0,0.05))",
                        borderRadius: "6px",
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{match.matched_value}</div>
                      <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                        Type: {match.match_type} · Confidence: {(match.confidence * 100).toFixed(0)}% ·{" "}
                        <span style={{ color: match.decision === "linked" ? "#198754" : "#ffc107" }}>
                          {match.decision}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                        {match.source_system} · {new Date(match.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{ marginTop: "1rem", textAlign: "right" }}>
              <button
                onClick={() => setShowMatchesModal(null)}
                style={{
                  padding: "0.5rem 1rem",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
