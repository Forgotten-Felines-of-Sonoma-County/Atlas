"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";

// Dynamically import the map component to avoid SSR issues with Leaflet
const BeaconMap = dynamic(() => import("@/components/BeaconMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: "600px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f3f4f6",
      }}
    >
      Loading map...
    </div>
  ),
});

interface MapData {
  places?: Array<{
    id: string;
    address: string;
    lat: number;
    lng: number;
    cat_count: number;
    priority: string;
    has_observation: boolean;
    service_zone: string;
  }>;
  google_pins?: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
    notes: string;
    entry_type: string;
    signals?: string[];
    cat_count?: number | null;
  }>;
  zones?: Array<{
    zone_id: string;
    zone_code: string;
    anchor_lat: number;
    anchor_lng: number;
    places_count: number;
    total_cats: number;
    observation_status: string;
    boundary?: string;
  }>;
  tnr_priority?: Array<{
    id: string;
    address: string;
    lat: number;
    lng: number;
    cat_count: number;
    altered_count: number;
    alteration_rate: number;
    tnr_priority: string;
    has_observation: boolean;
    service_zone: string;
  }>;
  summary?: {
    total_places: number;
    total_cats: number;
    zones_needing_obs: number;
  };
}

const SERVICE_ZONES = [
  "All Zones",
  "Santa Rosa",
  "Petaluma",
  "West County",
  "North County",
  "South County",
  "Sonoma Valley",
  "Other",
];

export default function BeaconPreviewPage() {
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Layer visibility
  const [showPlaces, setShowPlaces] = useState(true);
  const [showGooglePins, setShowGooglePins] = useState(false);
  const [showZones, setShowZones] = useState(false);
  const [showTnrPriority, setShowTnrPriority] = useState(false);

  // Filters
  const [selectedZone, setSelectedZone] = useState("All Zones");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const fetchMapData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const layers: string[] = [];
    if (showPlaces) layers.push("places");
    if (showGooglePins) layers.push("google_pins");
    if (showZones) layers.push("zones");
    if (showTnrPriority) layers.push("tnr_priority");

    if (layers.length === 0) {
      setMapData(null);
      setLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams({
        layers: layers.join(","),
      });
      if (selectedZone !== "All Zones") {
        params.set("zone", selectedZone);
      }

      const response = await fetch(`/api/beacon/map-data?${params}`);
      if (!response.ok) throw new Error("Failed to fetch map data");

      const data = await response.json();
      setMapData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load map data");
    } finally {
      setLoading(false);
    }
  }, [showPlaces, showGooglePins, showZones, showTnrPriority, selectedZone]);

  useEffect(() => {
    fetchMapData();
  }, [fetchMapData]);

  // Filter places by priority
  const filteredPlaces =
    priorityFilter === "all"
      ? mapData?.places
      : mapData?.places?.filter((p) => p.priority === priorityFilter);

  return (
    <div style={{ padding: "1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600 }}>
            Beacon Preview
          </h1>
          <p style={{ margin: "0.25rem 0 0", color: "#6b7280", fontSize: "0.875rem" }}>
            Visualize cat activity, historical data, and observation zones
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <a
            href="/admin"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#f3f4f6",
              borderRadius: "0.375rem",
              textDecoration: "none",
              color: "#374151",
              fontSize: "0.875rem",
            }}
          >
            Back to Admin
          </a>
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginBottom: "1rem",
          flexWrap: "wrap",
          padding: "1rem",
          backgroundColor: "white",
          borderRadius: "0.5rem",
          border: "1px solid #e5e7eb",
        }}
      >
        {/* Layer toggles */}
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "#6b7280",
              marginBottom: "0.5rem",
            }}
          >
            Layers
          </div>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <label
              style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={showPlaces}
                onChange={(e) => setShowPlaces(e.target.checked)}
              />
              <span
                style={{
                  display: "inline-block",
                  width: "0.75rem",
                  height: "0.75rem",
                  backgroundColor: "#3b82f6",
                  borderRadius: "50%",
                }}
              />
              Places ({mapData?.places?.length || 0})
            </label>
            <label
              style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={showGooglePins}
                onChange={(e) => setShowGooglePins(e.target.checked)}
              />
              <span
                style={{
                  display: "inline-block",
                  width: "0.75rem",
                  height: "0.75rem",
                  backgroundColor: "#f59e0b",
                  borderRadius: "50%",
                }}
              />
              Google Maps Pins ({mapData?.google_pins?.length || 0})
            </label>
            <label
              style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={showZones}
                onChange={(e) => setShowZones(e.target.checked)}
              />
              <span
                style={{
                  display: "inline-block",
                  width: "0.75rem",
                  height: "0.75rem",
                  backgroundColor: "#10b981",
                  borderRadius: "3px",
                }}
              />
              Observation Zones ({mapData?.zones?.length || 0})
            </label>
            <label
              style={{ display: "flex", alignItems: "center", gap: "0.25rem", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={showTnrPriority}
                onChange={(e) => setShowTnrPriority(e.target.checked)}
              />
              <span
                style={{
                  display: "inline-block",
                  width: "0.75rem",
                  height: "0.75rem",
                  backgroundColor: "#dc2626",
                  borderRadius: "50%",
                }}
              />
              Targeted TNR Priority ({mapData?.tnr_priority?.length || 0})
            </label>
          </div>
        </div>

        {/* Zone filter */}
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "#6b7280",
              marginBottom: "0.5rem",
            }}
          >
            Service Zone
          </div>
          <select
            value={selectedZone}
            onChange={(e) => setSelectedZone(e.target.value)}
            style={{
              padding: "0.375rem 0.75rem",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
            }}
          >
            {SERVICE_ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>

        {/* Priority filter */}
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "#6b7280",
              marginBottom: "0.5rem",
            }}
          >
            Priority
          </div>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            style={{
              padding: "0.375rem 0.75rem",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
            }}
          >
            <option value="all">All Priorities</option>
            <option value="high">High (10+ cats)</option>
            <option value="medium">Medium (5-9 cats)</option>
            <option value="low">Low (1-4 cats)</option>
          </select>
        </div>

        {/* Stats */}
        {mapData?.summary && (
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
              Showing {filteredPlaces?.length || 0} places
            </div>
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
              {mapData.summary.total_cats.toLocaleString()} cats linked
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          marginBottom: "1rem",
          padding: "0.75rem 1rem",
          backgroundColor: "#f9fafb",
          borderRadius: "0.375rem",
          fontSize: "0.75rem",
        }}
      >
        <div style={{ fontWeight: 500 }}>Legend:</div>
        {showPlaces && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <span
                style={{
                  width: "0.75rem",
                  height: "0.75rem",
                  backgroundColor: "#ef4444",
                  borderRadius: "50%",
                }}
              />
              High priority (10+ cats)
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <span
                style={{
                  width: "0.75rem",
                  height: "0.75rem",
                  backgroundColor: "#f59e0b",
                  borderRadius: "50%",
                }}
              />
              Medium (5-9 cats)
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <span
                style={{
                  width: "0.75rem",
                  height: "0.75rem",
                  backgroundColor: "#3b82f6",
                  borderRadius: "50%",
                }}
              />
              Low (1-4 cats)
            </div>
          </>
        )}
        {showGooglePins && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span
              style={{
                width: "0.75rem",
                height: "0.75rem",
                backgroundColor: "#8b5cf6",
                borderRadius: "50%",
                border: "2px solid #6d28d9",
              }}
            />
            Google Maps Entry (Historical)
          </div>
        )}
        {showZones && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <span
              style={{
                width: "0.75rem",
                height: "0.75rem",
                backgroundColor: "#10b981",
                border: "2px solid #059669",
                borderRadius: "3px",
              }}
            />
            Observation Zone
          </div>
        )}
        {showTnrPriority && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <span
                style={{
                  width: "0.75rem",
                  height: "0.75rem",
                  backgroundColor: "#dc2626",
                  borderRadius: "50%",
                }}
              />
              Critical (&lt;25% altered, 10+ cats)
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <span
                style={{
                  width: "0.75rem",
                  height: "0.75rem",
                  backgroundColor: "#ea580c",
                  borderRadius: "50%",
                }}
              />
              High (25-50% altered, 5+ cats)
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <span
                style={{
                  width: "0.75rem",
                  height: "0.75rem",
                  backgroundColor: "#ca8a04",
                  borderRadius: "50%",
                }}
              />
              Medium (50-75% altered)
            </div>
          </>
        )}
      </div>

      {/* Map */}
      {error ? (
        <div
          style={{
            padding: "2rem",
            textAlign: "center",
            backgroundColor: "#fef2f2",
            borderRadius: "0.5rem",
            color: "#b91c1c",
          }}
        >
          {error}
        </div>
      ) : (
        <BeaconMap
          places={filteredPlaces || []}
          googlePins={showGooglePins ? mapData?.google_pins || [] : []}
          zones={showZones ? mapData?.zones || [] : []}
          tnrPriority={showTnrPriority ? mapData?.tnr_priority || [] : []}
          loading={loading}
        />
      )}

      {/* Info panel */}
      <div
        style={{
          marginTop: "1rem",
          padding: "1rem",
          backgroundColor: "#f0fdf4",
          borderRadius: "0.5rem",
          border: "1px solid #86efac",
        }}
      >
        <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.875rem", fontWeight: 600 }}>
          About This Preview
        </h3>
        <p style={{ margin: 0, fontSize: "0.875rem", color: "#166534" }}>
          This map shows historical cat activity data that will inform Beacon&apos;s observation
          zone system. <strong>Google Maps pins</strong> contain years of qualitative notes about
          feeding stations and colonies. <strong>Places</strong> show verified FFSC clinic data.{" "}
          <strong>Observation zones</strong> are sampling units where field observations will be
          collected to enable Chapman population estimation.
        </p>
      </div>
    </div>
  );
}
