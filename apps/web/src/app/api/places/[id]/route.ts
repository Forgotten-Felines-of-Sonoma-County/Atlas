import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";
import { logFieldEdits } from "@/lib/audit";

interface PlaceDetailRow {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  place_kind: string | null;
  is_address_backed: boolean;
  has_cat_activity: boolean;
  locality: string | null;
  postal_code: string | null;
  state_province: string | null;
  coordinates: { lat: number; lng: number } | null;
  created_at: string;
  updated_at: string;
  cats: object[] | null;
  people: object[] | null;
  place_relationships: object[] | null;
  cat_count: number;
  person_count: number;
}

interface VerificationInfo {
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    // First check if this place was merged into another
    const mergeCheck = await queryOne<{ merged_into_place_id: string | null }>(
      `SELECT merged_into_place_id FROM trapper.places WHERE place_id = $1`,
      [id]
    );

    // If place was merged, use the canonical place ID
    const placeId = mergeCheck?.merged_into_place_id || id;

    const sql = `
      SELECT
        place_id,
        display_name,
        formatted_address,
        place_kind,
        is_address_backed,
        has_cat_activity,
        locality,
        postal_code,
        state_province,
        coordinates,
        created_at,
        updated_at,
        cats,
        people,
        place_relationships,
        cat_count,
        person_count
      FROM trapper.v_place_detail_v2
      WHERE place_id = $1
    `;

    const place = await queryOne<PlaceDetailRow>(sql, [placeId]);

    if (!place) {
      return NextResponse.json(
        { error: "Place not found" },
        { status: 404 }
      );
    }

    // Fetch verification info from places table
    const verification = await queryOne<VerificationInfo>(
      `SELECT
         p.verified_at,
         p.verified_by,
         s.display_name AS verified_by_name
       FROM trapper.places p
       LEFT JOIN trapper.staff s ON p.verified_by = s.staff_id::text
       WHERE p.place_id = $1`,
      [placeId]
    );

    const response = {
      ...place,
      verified_at: verification?.verified_at || null,
      verified_by: verification?.verified_by || null,
      verified_by_name: verification?.verified_by_name || null,
    };

    // Include redirect info if the original ID was merged
    if (mergeCheck?.merged_into_place_id) {
      return NextResponse.json({
        ...response,
        _merged_from: id,
        _canonical_id: placeId,
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching place detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch place detail" },
      { status: 500 }
    );
  }
}

// Valid place kinds matching the database enum
const VALID_PLACE_KINDS = [
  "unknown",
  "residential_house",
  "apartment_unit",
  "apartment_building",
  "business",
  "clinic",
  "neighborhood",
  "outdoor_site",
] as const;

interface UpdatePlaceBody {
  display_name?: string;
  place_kind?: string;
  // Address correction fields (with audit tracking)
  formatted_address?: string;
  locality?: string;
  postal_code?: string;
  state_province?: string;
  latitude?: number;
  longitude?: number;
  // Audit info
  changed_by?: string;
  change_reason?: string;
  change_notes?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Place ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: UpdatePlaceBody = await request.json();
    const changed_by = body.changed_by || "web_user";
    const change_reason = body.change_reason || "manual_update";
    const change_notes = body.change_notes || null;

    // Validate place_kind if provided
    if (body.place_kind && !VALID_PLACE_KINDS.includes(body.place_kind as typeof VALID_PLACE_KINDS[number])) {
      return NextResponse.json(
        { error: `Invalid place_kind. Must be one of: ${VALID_PLACE_KINDS.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate display_name if provided
    if (body.display_name !== undefined && body.display_name.trim() === "") {
      return NextResponse.json(
        { error: "display_name cannot be empty" },
        { status: 400 }
      );
    }

    // Fields that require audit tracking
    const auditedFields = ["formatted_address", "locality", "postal_code", "state_province"];
    const simpleFields = ["display_name", "place_kind"];

    // Build dynamic update query
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Simple fields (no audit needed for display_name and place_kind changes)
    if (body.display_name !== undefined) {
      updates.push(`display_name = $${paramIndex}`);
      values.push(body.display_name.trim());
      paramIndex++;
    }

    if (body.place_kind !== undefined) {
      updates.push(`place_kind = $${paramIndex}::trapper.place_kind`);
      values.push(body.place_kind);
      paramIndex++;
    }

    // Address fields - with audit tracking
    // First, get current values for audit log
    if (body.formatted_address !== undefined || body.locality !== undefined ||
        body.postal_code !== undefined || body.state_province !== undefined ||
        body.latitude !== undefined || body.longitude !== undefined) {

      // Get current place data for audit comparison
      const currentSql = `
        SELECT formatted_address, locality, postal_code, state_province,
               ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng
        FROM trapper.places WHERE place_id = $1
      `;
      const current = await queryOne<{
        formatted_address: string | null;
        locality: string | null;
        postal_code: string | null;
        state_province: string | null;
        lat: number | null;
        lng: number | null;
      }>(currentSql, [id]);

      if (!current) {
        return NextResponse.json({ error: "Place not found" }, { status: 404 });
      }

      // Log changes to place_changes table using parameterized queries (prevents SQL injection)
      const auditChanges: { field: string; oldVal: string | null; newVal: string }[] = [];

      if (body.formatted_address !== undefined && body.formatted_address !== current.formatted_address) {
        auditChanges.push({
          field: 'formatted_address',
          oldVal: current.formatted_address,
          newVal: body.formatted_address
        });
        updates.push(`formatted_address = $${paramIndex}`);
        values.push(body.formatted_address);
        paramIndex++;
      }

      if (body.locality !== undefined && body.locality !== current.locality) {
        auditChanges.push({
          field: 'locality',
          oldVal: current.locality,
          newVal: body.locality
        });
        updates.push(`locality = $${paramIndex}`);
        values.push(body.locality);
        paramIndex++;
      }

      if (body.postal_code !== undefined && body.postal_code !== current.postal_code) {
        updates.push(`postal_code = $${paramIndex}`);
        values.push(body.postal_code);
        paramIndex++;
      }

      if (body.state_province !== undefined && body.state_province !== current.state_province) {
        updates.push(`state_province = $${paramIndex}`);
        values.push(body.state_province);
        paramIndex++;
      }

      // Update coordinates if provided
      if (body.latitude !== undefined && body.longitude !== undefined) {
        const coordChanged = current.lat !== body.latitude || current.lng !== body.longitude;
        if (coordChanged) {
          auditChanges.push({
            field: 'coordinates',
            oldVal: current.lat !== null && current.lng !== null ? `${current.lat},${current.lng}` : null,
            newVal: `${body.latitude},${body.longitude}`
          });
          updates.push(`location = ST_SetSRID(ST_MakePoint($${paramIndex}, $${paramIndex + 1}), 4326)`);
          values.push(body.longitude, body.latitude);
          paramIndex += 2;
        }
      }

      // Log changes to centralized entity_edits table
      if (auditChanges.length > 0) {
        await logFieldEdits(
          "place",
          id,
          auditChanges.map((c) => ({
            field: c.field,
            oldValue: c.oldVal,
            newValue: c.newVal,
          })),
          {
            editedBy: changed_by,
            reason: change_reason,
            editSource: "web_ui",
          }
        );
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Add place_id to values
    values.push(id);

    const sql = `
      UPDATE trapper.places
      SET ${updates.join(", ")}
      WHERE place_id = $${paramIndex}
      RETURNING place_id, display_name, place_kind, is_address_backed, formatted_address
    `;

    const result = await queryOne<{
      place_id: string;
      display_name: string;
      place_kind: string;
      is_address_backed: boolean;
      formatted_address: string | null;
    }>(sql, values);

    if (!result) {
      return NextResponse.json(
        { error: "Place not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      place: result,
    });
  } catch (error) {
    console.error("Error updating place:", error);
    return NextResponse.json(
      { error: "Failed to update place" },
      { status: 500 }
    );
  }
}
