import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

/**
 * GET /api/beacon/map-data
 *
 * Returns geographic data for the Beacon preview map.
 * Supports multiple layers that can be toggled on/off.
 *
 * Query params:
 *   - layers: comma-separated list of layers to include
 *     - places: Places with cat activity
 *     - google_pins: Google Maps entries with parsed signals
 *     - zones: Observation zones
 *     - tnr_priority: Targeted TNR priority layer (ecology data)
 *   - zone: filter by service_zone (optional)
 *   - bounds: lat1,lng1,lat2,lng2 bounding box (optional)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const layersParam = searchParams.get("layers") || "places";
  const layers = layersParam.split(",").map((l) => l.trim());
  const zone = searchParams.get("zone");
  const bounds = searchParams.get("bounds");

  const result: {
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
      signals: string[];
      cat_count: number | null;
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
    zones?: Array<{
      zone_id: string;
      zone_code: string;
      anchor_lat: number;
      anchor_lng: number;
      places_count: number;
      total_cats: number;
      observation_status: string;
      boundary?: string; // GeoJSON
    }>;
    summary?: {
      total_places: number;
      total_cats: number;
      zones_needing_obs: number;
    };
  } = {};

  try {
    // Build zone filter
    const zoneFilter = zone ? `AND p.service_zone = '${zone}'` : "";

    // Places layer
    if (layers.includes("places")) {
      const places = await queryRows<{
        id: string;
        address: string;
        lat: number;
        lng: number;
        cat_count: number;
        priority: string;
        has_observation: boolean;
        service_zone: string;
      }>(`
        WITH place_stats AS (
          SELECT
            p.place_id as id,
            p.formatted_address as address,
            ST_Y(p.location::geometry) as lat,
            ST_X(p.location::geometry) as lng,
            COALESCE(cc.cat_count, 0) as cat_count,
            CASE
              WHEN COALESCE(cc.cat_count, 0) >= 10 THEN 'high'
              WHEN COALESCE(cc.cat_count, 0) >= 5 THEN 'medium'
              ELSE 'low'
            END as priority,
            EXISTS (
              SELECT 1 FROM trapper.place_colony_estimates pce
              WHERE pce.place_id = p.place_id AND pce.eartip_count_observed > 0
            ) as has_observation,
            COALESCE(p.service_zone, 'Unknown') as service_zone
          FROM trapper.places p
          LEFT JOIN (
            SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
            FROM trapper.cat_place_relationships
            GROUP BY place_id
          ) cc ON cc.place_id = p.place_id
          WHERE p.merged_into_place_id IS NULL
            AND p.location IS NOT NULL
            AND COALESCE(cc.cat_count, 0) > 0
            ${zoneFilter}
        )
        SELECT * FROM place_stats
        ORDER BY cat_count DESC
        LIMIT 5000
      `);
      result.places = places;
    }

    // Google Maps pins layer
    if (layers.includes("google_pins")) {
      const pins = await queryRows<{
        id: string;
        name: string;
        lat: number;
        lng: number;
        notes: string;
        entry_type: string;
        signals: string[];
        cat_count: number | null;
      }>(`
        SELECT
          entry_id::text as id,
          COALESCE(kml_name, 'Unnamed') as name,
          lat,
          lng,
          COALESCE(original_content, '') as notes,
          COALESCE(
            CASE
              WHEN parsed_signals->>'signals' IS NOT NULL
                AND jsonb_array_length(parsed_signals->'signals') > 0
              THEN (parsed_signals->'signals'->>0)
              ELSE 'general'
            END,
            'general'
          ) as entry_type,
          COALESCE(
            ARRAY(SELECT jsonb_array_elements_text(parsed_signals->'signals')),
            ARRAY[]::text[]
          ) as signals,
          parsed_cat_count as cat_count
        FROM trapper.google_map_entries
        WHERE lat IS NOT NULL
          AND lng IS NOT NULL
        ORDER BY imported_at DESC
        LIMIT 2000
      `);
      result.google_pins = pins;
    }

    // TNR Priority layer (Targeted TNR data)
    if (layers.includes("tnr_priority")) {
      const tnrData = await queryRows<{
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
      }>(`
        WITH place_stats AS (
          SELECT
            p.place_id as id,
            p.formatted_address as address,
            ST_Y(p.location::geometry) as lat,
            ST_X(p.location::geometry) as lng,
            COALESCE(cc.cat_count, 0) as cat_count,
            COALESCE(ac.altered_count, 0) as altered_count,
            CASE
              WHEN COALESCE(cc.cat_count, 0) > 0
              THEN ROUND(100.0 * COALESCE(ac.altered_count, 0) / COALESCE(cc.cat_count, 1), 1)
              ELSE 0
            END as alteration_rate,
            CASE
              WHEN COALESCE(cc.cat_count, 0) >= 10 AND COALESCE(ac.altered_count, 0)::float / NULLIF(cc.cat_count, 0) < 0.25 THEN 'critical'
              WHEN COALESCE(cc.cat_count, 0) >= 5 AND COALESCE(ac.altered_count, 0)::float / NULLIF(cc.cat_count, 0) < 0.50 THEN 'high'
              WHEN COALESCE(ac.altered_count, 0)::float / NULLIF(cc.cat_count, 0) < 0.75 THEN 'medium'
              WHEN COALESCE(ac.altered_count, 0)::float / NULLIF(cc.cat_count, 0) >= 0.75 THEN 'managed'
              ELSE 'unknown'
            END as tnr_priority,
            EXISTS (
              SELECT 1 FROM trapper.place_colony_estimates pce
              WHERE pce.place_id = p.place_id AND pce.eartip_count_observed > 0
            ) as has_observation,
            COALESCE(p.service_zone, 'Unknown') as service_zone
          FROM trapper.places p
          LEFT JOIN (
            SELECT place_id, COUNT(DISTINCT cat_id) as cat_count
            FROM trapper.cat_place_relationships
            GROUP BY place_id
          ) cc ON cc.place_id = p.place_id
          LEFT JOIN (
            SELECT cpr.place_id, COUNT(DISTINCT cp.cat_id) as altered_count
            FROM trapper.cat_place_relationships cpr
            JOIN trapper.cat_procedures cp ON cp.cat_id = cpr.cat_id
            WHERE cp.is_spay OR cp.is_neuter
            GROUP BY cpr.place_id
          ) ac ON ac.place_id = p.place_id
          WHERE p.merged_into_place_id IS NULL
            AND p.location IS NOT NULL
            AND COALESCE(cc.cat_count, 0) > 0
            ${zoneFilter}
        )
        SELECT * FROM place_stats
        WHERE tnr_priority IN ('critical', 'high', 'medium')
        ORDER BY
          CASE tnr_priority
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
          END,
          cat_count DESC
        LIMIT 3000
      `);
      result.tnr_priority = tnrData;
    }

    // Observation zones layer
    if (layers.includes("zones")) {
      const zones = await queryRows<{
        zone_id: string;
        zone_code: string;
        anchor_lat: number;
        anchor_lng: number;
        places_count: number;
        total_cats: number;
        observation_status: string;
        boundary: string;
      }>(`
        SELECT
          oz.zone_id::text,
          oz.zone_code,
          ST_Y(oz.centroid::geometry) as anchor_lat,
          ST_X(oz.centroid::geometry) as anchor_lng,
          COALESCE(zs.places_in_zone, 0)::int as places_count,
          COALESCE(zs.total_cats_linked, 0)::int as total_cats,
          COALESCE(zs.observation_status, 'unknown') as observation_status,
          ST_AsGeoJSON(oz.boundary_geom) as boundary
        FROM trapper.observation_zones oz
        LEFT JOIN trapper.v_observation_zone_summary zs ON zs.zone_id = oz.zone_id
        WHERE oz.status = 'active'
          ${zone ? `AND oz.service_zone = '${zone}'` : ""}
        ORDER BY COALESCE(zs.total_cats_linked, 0) DESC
      `);
      result.zones = zones;
    }

    // Summary stats
    const summary = await queryRows<{
      total_places: number;
      total_cats: number;
      zones_needing_obs: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM trapper.places WHERE merged_into_place_id IS NULL AND location IS NOT NULL ${zoneFilter.replace('p.', '')}) as total_places,
        (SELECT COUNT(*) FROM trapper.cat_place_relationships) as total_cats,
        (SELECT COUNT(*) FROM trapper.observation_zones WHERE status = 'active') as zones_needing_obs
    `);
    result.summary = summary[0];

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching map data:", error);
    return NextResponse.json(
      { error: "Failed to fetch map data" },
      { status: 500 }
    );
  }
}
