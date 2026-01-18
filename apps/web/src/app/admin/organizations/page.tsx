"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Organization {
  org_id: string;
  parent_org_id: string | null;
  org_code: string;
  display_name: string;
  org_type: "parent" | "department" | "program";
  description: string | null;
  is_internal: boolean;
  created_at: string;
  member_count: number;
  cat_count: number;
}

interface Member {
  link_id: string;
  person_id: string;
  display_name: string;
  link_type: string;
  link_reason: string | null;
  email: string | null;
  phone: string | null;
  staff_role: string | null;
  staff_department: string | null;
  created_at: string;
}

interface OrgCat {
  relationship_id: string;
  cat_id: string;
  cat_name: string | null;
  relationship_type: string;
  original_account_name: string | null;
  sex: string | null;
  microchip: string | null;
  created_at: string;
}

interface ChildOrg {
  org_id: string;
  org_code: string;
  display_name: string;
  org_type: string;
  member_count: number;
  cat_count: number;
}

interface OrgDetail {
  organization: Organization;
  members: Member[];
  cats: OrgCat[];
  cat_count: number;
  children: ChildOrg[];
}

const ORG_TYPE_COLORS: Record<string, string> = {
  parent: "#6f42c1",
  department: "#198754",
  program: "#0d6efd",
};

export default function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<OrgDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchOrganizations = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/organizations");
      if (response.ok) {
        const data = await response.json();
        setOrganizations(data.organizations || []);
      }
    } catch (err) {
      console.error("Failed to fetch organizations:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  const fetchOrgDetail = async (orgId: string) => {
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/organizations/${orgId}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedOrg(data);
      }
    } catch (err) {
      console.error("Failed to fetch org detail:", err);
    } finally {
      setLoadingDetail(false);
    }
  };

  // Group by type
  const parentOrgs = organizations.filter((o) => o.org_type === "parent");
  const departments = organizations.filter((o) => o.org_type === "department");
  const programs = organizations.filter((o) => o.org_type === "program");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h1 style={{ margin: 0 }}>Organizations</h1>
        <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
          {organizations.length} organizations
        </span>
      </div>

      {loading ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
          Loading...
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
          {/* Parent Organizations */}
          {parentOrgs.length > 0 && (
            <section>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 500, color: ORG_TYPE_COLORS.parent }}>
                Parent Organizations
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "0.75rem" }}>
                {parentOrgs.map((org) => (
                  <OrgCard key={org.org_id} org={org} onClick={() => fetchOrgDetail(org.org_id)} />
                ))}
              </div>
            </section>
          )}

          {/* Departments */}
          {departments.length > 0 && (
            <section>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 500, color: ORG_TYPE_COLORS.department }}>
                Departments
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
                {departments.map((org) => (
                  <OrgCard key={org.org_id} org={org} onClick={() => fetchOrgDetail(org.org_id)} />
                ))}
              </div>
            </section>
          )}

          {/* External Programs */}
          {programs.length > 0 && (
            <section>
              <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 500, color: ORG_TYPE_COLORS.program }}>
                External Programs
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
                {programs.map((org) => (
                  <OrgCard key={org.org_id} org={org} onClick={() => fetchOrgDetail(org.org_id)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Detail Modal */}
      {selectedOrg && (
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
          onClick={() => setSelectedOrg(null)}
        >
          <div
            style={{
              background: "var(--background)",
              borderRadius: "12px",
              padding: "1.5rem",
              maxWidth: "700px",
              width: "90%",
              maxHeight: "85vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {loadingDetail ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                Loading...
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
                  <div>
                    <h2 style={{ margin: 0 }}>{selectedOrg.organization.display_name}</h2>
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                      <span
                        style={{
                          fontSize: "0.7rem",
                          padding: "0.125rem 0.5rem",
                          background: ORG_TYPE_COLORS[selectedOrg.organization.org_type],
                          color: "#fff",
                          borderRadius: "4px",
                          textTransform: "uppercase",
                        }}
                      >
                        {selectedOrg.organization.org_type}
                      </span>
                      <span
                        style={{
                          fontSize: "0.7rem",
                          padding: "0.125rem 0.5rem",
                          background: selectedOrg.organization.is_internal ? "#6c757d" : "#17a2b8",
                          color: "#fff",
                          borderRadius: "4px",
                        }}
                      >
                        {selectedOrg.organization.is_internal ? "Internal" : "External"}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedOrg(null)}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: "1.5rem",
                      cursor: "pointer",
                      color: "var(--muted)",
                    }}
                  >
                    x
                  </button>
                </div>

                {selectedOrg.organization.description && (
                  <p style={{ margin: "0 0 1rem", color: "var(--muted)", fontSize: "0.9rem" }}>
                    {selectedOrg.organization.description}
                  </p>
                )}

                {/* Stats Row */}
                <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem" }}>
                  <StatBox label="Members" value={selectedOrg.members.length} />
                  <StatBox label="Cats" value={selectedOrg.cat_count} />
                  {selectedOrg.children.length > 0 && (
                    <StatBox label="Sub-orgs" value={selectedOrg.children.length} />
                  )}
                </div>

                {/* Child Organizations */}
                {selectedOrg.children.length > 0 && (
                  <section style={{ marginBottom: "1.5rem" }}>
                    <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>
                      Departments
                    </h4>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      {selectedOrg.children.map((child) => (
                        <button
                          key={child.org_id}
                          onClick={() => fetchOrgDetail(child.org_id)}
                          style={{
                            padding: "0.375rem 0.75rem",
                            background: "var(--card-bg, rgba(0,0,0,0.05))",
                            border: "1px solid var(--border)",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                          }}
                        >
                          {child.display_name}
                          <span style={{ marginLeft: "0.5rem", color: "var(--muted)" }}>
                            ({child.member_count})
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* Members */}
                <section style={{ marginBottom: "1.5rem" }}>
                  <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>
                    Members ({selectedOrg.members.length})
                  </h4>
                  {selectedOrg.members.length === 0 ? (
                    <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>No members</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "200px", overflow: "auto" }}>
                      {selectedOrg.members.map((m) => (
                        <div
                          key={m.link_id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "0.5rem",
                            background: "var(--card-bg, rgba(0,0,0,0.03))",
                            borderRadius: "6px",
                            fontSize: "0.85rem",
                          }}
                        >
                          <div>
                            <Link
                              href={`/people/${m.person_id}`}
                              style={{ fontWeight: 500, color: "var(--foreground)" }}
                            >
                              {m.display_name}
                            </Link>
                            {m.staff_role && (
                              <span style={{ color: "var(--muted)", marginLeft: "0.5rem" }}>
                                - {m.staff_role}
                              </span>
                            )}
                          </div>
                          <span
                            style={{
                              fontSize: "0.7rem",
                              padding: "0.125rem 0.5rem",
                              background: m.link_type === "staff" ? "#198754" : "#6c757d",
                              color: "#fff",
                              borderRadius: "4px",
                            }}
                          >
                            {m.link_type}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Cats */}
                {selectedOrg.cat_count > 0 && (
                  <section>
                    <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>
                      Cats ({selectedOrg.cat_count})
                    </h4>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "200px", overflow: "auto" }}>
                      {selectedOrg.cats.slice(0, 50).map((c) => (
                        <div
                          key={c.relationship_id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "0.5rem",
                            background: "var(--card-bg, rgba(0,0,0,0.03))",
                            borderRadius: "6px",
                            fontSize: "0.85rem",
                          }}
                        >
                          <div>
                            <Link
                              href={`/cats/${c.cat_id}`}
                              style={{ fontWeight: 500, color: "var(--foreground)" }}
                            >
                              {c.cat_name || "Unknown"}
                            </Link>
                            {c.original_account_name && (
                              <span style={{ color: "var(--muted)", marginLeft: "0.5rem", fontSize: "0.75rem" }}>
                                via {c.original_account_name}
                              </span>
                            )}
                          </div>
                          {c.microchip && (
                            <span style={{ fontSize: "0.7rem", color: "var(--muted)", fontFamily: "monospace" }}>
                              {c.microchip}
                            </span>
                          )}
                        </div>
                      ))}
                      {selectedOrg.cat_count > 50 && (
                        <p style={{ fontSize: "0.75rem", color: "var(--muted)", textAlign: "center" }}>
                          + {selectedOrg.cat_count - 50} more cats
                        </p>
                      )}
                    </div>
                  </section>
                )}

                <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                  <button
                    onClick={() => setSelectedOrg(null)}
                    style={{
                      padding: "0.5rem 1rem",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      cursor: "pointer",
                      background: "var(--background)",
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OrgCard({ org, onClick }: { org: Organization; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "1rem",
        background: "var(--card-bg, rgba(0,0,0,0.05))",
        borderRadius: "8px",
        cursor: "pointer",
        border: "1px solid transparent",
        transition: "border-color 0.2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "transparent")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1rem" }}>{org.display_name}</div>
          <div style={{ color: "var(--muted)", fontSize: "0.8rem", fontFamily: "monospace" }}>
            {org.org_code}
          </div>
        </div>
        {!org.is_internal && (
          <span
            style={{
              fontSize: "0.65rem",
              padding: "0.125rem 0.375rem",
              background: "#17a2b8",
              color: "#fff",
              borderRadius: "4px",
            }}
          >
            External
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: "1rem", marginTop: "0.75rem", fontSize: "0.8rem", color: "var(--muted)" }}>
        <span>{org.member_count} members</span>
        {org.cat_count > 0 && <span>{org.cat_count} cats</span>}
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        flex: 1,
        padding: "0.75rem",
        background: "var(--card-bg, rgba(0,0,0,0.05))",
        borderRadius: "8px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{label}</div>
    </div>
  );
}
