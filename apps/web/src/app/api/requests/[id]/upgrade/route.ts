import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";

interface UpgradeRequestBody {
  upgraded_by?: string;
  // Questionnaire answers
  permission_status?: "yes" | "no" | "pending" | "not_needed" | "unknown";
  access_notes?: string;
  traps_overnight_safe?: boolean;
  access_without_contact?: boolean;
  colony_duration?: "under_1_month" | "1_to_6_months" | "6_to_24_months" | "over_2_years" | "unknown";
  count_confidence?: "exact" | "good_estimate" | "rough_guess" | "unknown";
  is_being_fed?: boolean;
  feeding_schedule?: string;
  best_times_seen?: string;
  urgency_reasons?: string[];
  urgency_notes?: string;
  // Special cases
  kittens_already_taken?: boolean;
  already_assessed?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: UpgradeRequestBody = await request.json();

    // Call the upgrade function
    const sql = `
      SELECT trapper.upgrade_legacy_request(
        $1::UUID,
        $2::TEXT,
        $3::TEXT,
        $4::TEXT,
        $5::BOOLEAN,
        $6::BOOLEAN,
        $7::TEXT,
        $8::TEXT,
        $9::BOOLEAN,
        $10::TEXT,
        $11::TEXT,
        $12::TEXT[],
        $13::TEXT,
        $14::BOOLEAN,
        $15::BOOLEAN
      ) AS new_request_id
    `;

    const result = await queryOne<{ new_request_id: string }>(sql, [
      id,
      body.upgraded_by || "web_user",
      body.permission_status || null,
      body.access_notes || null,
      body.traps_overnight_safe ?? null,
      body.access_without_contact ?? null,
      body.colony_duration || null,
      body.count_confidence || null,
      body.is_being_fed ?? null,
      body.feeding_schedule || null,
      body.best_times_seen || null,
      body.urgency_reasons || null,
      body.urgency_notes || null,
      body.kittens_already_taken || false,
      body.already_assessed || false,
    ]);

    if (!result || !result.new_request_id) {
      return NextResponse.json(
        { error: "Failed to upgrade request" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      new_request_id: result.new_request_id,
      archived_request_id: id,
      message: "Legacy request successfully upgraded to Atlas format",
    });
  } catch (error) {
    console.error("Error upgrading request:", error);

    // Check for specific error messages
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (errorMessage.includes("not a legacy Airtable request")) {
      return NextResponse.json(
        { error: "This request is not a legacy Airtable request and cannot be upgraded" },
        { status: 400 }
      );
    }

    if (errorMessage.includes("already been upgraded")) {
      return NextResponse.json(
        { error: "This request has already been upgraded" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to upgrade request: " + errorMessage },
      { status: 500 }
    );
  }
}

// GET endpoint to check if upgrade is available
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Request ID is required" },
      { status: 400 }
    );
  }

  try {
    const sql = `
      SELECT
        request_id,
        source_system,
        status,
        CASE
          WHEN source_system != 'airtable' THEN 'not_legacy'
          WHEN status = 'cancelled' AND resolution_notes LIKE 'Upgraded to Atlas request%' THEN 'already_upgraded'
          ELSE 'can_upgrade'
        END AS upgrade_status,
        CASE
          WHEN status = 'cancelled' AND resolution_notes LIKE 'Upgraded to Atlas request%'
          THEN SUBSTRING(resolution_notes FROM 'Upgraded to Atlas request: ([a-f0-9-]+)')
          ELSE NULL
        END AS upgraded_to_request_id
      FROM trapper.sot_requests
      WHERE request_id = $1
    `;

    const result = await queryOne<{
      request_id: string;
      source_system: string | null;
      status: string;
      upgrade_status: string;
      upgraded_to_request_id: string | null;
    }>(sql, [id]);

    if (!result) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      request_id: result.request_id,
      source_system: result.source_system,
      status: result.status,
      upgrade_status: result.upgrade_status,
      can_upgrade: result.upgrade_status === "can_upgrade",
      upgraded_to_request_id: result.upgraded_to_request_id,
    });
  } catch (error) {
    console.error("Error checking upgrade status:", error);
    return NextResponse.json(
      { error: "Failed to check upgrade status" },
      { status: 500 }
    );
  }
}
