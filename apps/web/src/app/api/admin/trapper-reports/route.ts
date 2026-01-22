import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryRows, queryOne, execute } from "@/lib/db";

/**
 * GET /api/admin/trapper-reports
 * List trapper report submissions with stats
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "all";
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    // Build status filter
    const statusFilter =
      status === "all"
        ? ""
        : "WHERE s.extraction_status = $1";
    const params = status === "all" ? [] : [status];

    // Get submissions with item counts
    const submissions = await queryRows(
      `
      SELECT
        s.submission_id::text,
        s.reporter_email,
        s.reporter_person_id::text,
        s.reporter_match_confidence,
        s.content_type,
        s.received_at,
        s.extraction_status,
        s.extracted_at,
        s.reviewed_by,
        s.reviewed_at,
        s.created_at,
        SUBSTRING(s.raw_content, 1, 300) as content_preview,
        -- Reporter name if matched
        p.display_name as reporter_name,
        -- Item counts
        COUNT(i.item_id) as total_items,
        COUNT(i.item_id) FILTER (WHERE i.review_status = 'pending') as pending_items,
        COUNT(i.item_id) FILTER (WHERE i.review_status = 'approved') as approved_items,
        COUNT(i.item_id) FILTER (WHERE i.review_status = 'rejected') as rejected_items,
        COUNT(i.item_id) FILTER (WHERE i.committed_at IS NOT NULL) as committed_items
      FROM trapper.trapper_report_submissions s
      LEFT JOIN trapper.sot_people p ON p.person_id = s.reporter_person_id
      LEFT JOIN trapper.trapper_report_items i ON i.submission_id = s.submission_id
      ${statusFilter}
      GROUP BY s.submission_id, p.display_name
      ORDER BY s.received_at DESC
      LIMIT ${limit} OFFSET ${offset}
      `,
      params
    );

    // Get stats
    const stats = await queryOne<{
      pending: string;
      extracting: string;
      extracted: string;
      reviewed: string;
      committed: string;
      failed: string;
      total: string;
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE extraction_status = 'pending') as pending,
        COUNT(*) FILTER (WHERE extraction_status = 'extracting') as extracting,
        COUNT(*) FILTER (WHERE extraction_status = 'extracted') as extracted,
        COUNT(*) FILTER (WHERE extraction_status = 'reviewed') as reviewed,
        COUNT(*) FILTER (WHERE extraction_status = 'committed') as committed,
        COUNT(*) FILTER (WHERE extraction_status = 'failed') as failed,
        COUNT(*) as total
      FROM trapper.trapper_report_submissions
      `
    );

    return NextResponse.json({
      submissions,
      stats: stats
        ? {
            pending: parseInt(stats.pending),
            extracting: parseInt(stats.extracting),
            extracted: parseInt(stats.extracted),
            reviewed: parseInt(stats.reviewed),
            committed: parseInt(stats.committed),
            failed: parseInt(stats.failed),
            total: parseInt(stats.total),
          }
        : null,
    });
  } catch (error) {
    console.error("Error fetching trapper reports:", error);
    return NextResponse.json(
      { error: "Failed to fetch trapper reports" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/trapper-reports
 * Submit a new trapper report for processing
 */
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.auth_role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { reporter_email, content, content_type = "email" } = body;

    if (!content || content.trim().length < 10) {
      return NextResponse.json(
        { error: "Content is required and must be at least 10 characters" },
        { status: 400 }
      );
    }

    // Validate content_type
    const validTypes = ["email", "form", "sms", "notes"];
    if (!validTypes.includes(content_type)) {
      return NextResponse.json(
        { error: `Invalid content_type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Insert submission
    const result = await queryOne<{ submission_id: string }>(
      `
      INSERT INTO trapper.trapper_report_submissions (
        reporter_email,
        raw_content,
        content_type,
        source_system
      ) VALUES ($1, $2, $3, 'web_ui')
      RETURNING submission_id::text
      `,
      [reporter_email || null, content.trim(), content_type]
    );

    if (!result) {
      return NextResponse.json(
        { error: "Failed to create submission" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      submission_id: result.submission_id,
      message: "Report submitted. Run extraction to process.",
    });
  } catch (error) {
    console.error("Error creating trapper report:", error);
    return NextResponse.json(
      { error: "Failed to create trapper report" },
      { status: 500 }
    );
  }
}
