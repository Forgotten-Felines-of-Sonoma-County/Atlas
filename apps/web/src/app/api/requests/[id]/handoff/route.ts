import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface HandoffResult {
  original_request_id: string;
  new_request_id: string;
  handoff_status: string;
}

/**
 * POST /api/requests/[id]/handoff
 *
 * Hands off a request to a new caretaker at a new location.
 * Unlike redirect (which implies the original address was wrong),
 * handoff represents legitimate succession of responsibility.
 *
 * Creates a new request linked to the original with non-overlapping
 * attribution windows to prevent double-counting in Beacon stats.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // Require authentication
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id: requestId } = await params;
    const body = await request.json();

    const {
      handoff_reason,
      new_address,
      new_requester_name,
      new_requester_phone,
      new_requester_email,
      summary,
      notes,
      estimated_cat_count,
    } = body;

    // Validate required fields
    if (!handoff_reason) {
      return NextResponse.json(
        { error: "Handoff reason is required" },
        { status: 400 }
      );
    }

    if (!new_address) {
      return NextResponse.json(
        { error: "New address is required for handoff" },
        { status: 400 }
      );
    }

    if (!new_requester_name) {
      return NextResponse.json(
        { error: "New caretaker name is required" },
        { status: 400 }
      );
    }

    // Call the handoff_request function
    const result = await queryOne<HandoffResult>(
      `SELECT * FROM trapper.handoff_request(
        p_original_request_id := $1,
        p_handoff_reason := $2,
        p_new_address := $3,
        p_new_requester_name := $4,
        p_new_requester_phone := $5,
        p_new_requester_email := $6,
        p_summary := $7,
        p_notes := $8,
        p_estimated_cat_count := $9,
        p_created_by := $10
      )`,
      [
        requestId,
        handoff_reason,
        new_address,
        new_requester_name,
        new_requester_phone || null,
        new_requester_email || null,
        summary || null,
        notes || null,
        estimated_cat_count || null,
        `staff:${session.staff_id}`,
      ]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to hand off request" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      original_request_id: result.original_request_id,
      new_request_id: result.new_request_id,
      handoff_url: `/requests/${result.new_request_id}`,
    });
  } catch (error) {
    console.error("Handoff request error:", error);

    // Handle specific error messages from the function
    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return NextResponse.json({ error: "Request not found" }, { status: 404 });
      }
      if (error.message.includes("already been closed")) {
        return NextResponse.json(
          { error: "This request has already been closed and cannot be handed off" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "Failed to hand off request" },
      { status: 500 }
    );
  }
}
