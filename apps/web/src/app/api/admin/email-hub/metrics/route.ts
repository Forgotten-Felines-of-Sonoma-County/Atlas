import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { requireRole, AuthError } from "@/lib/auth";

interface EmailHubMetrics {
  connected_accounts: number;
  active_templates: number;
  pending_jobs: number;
  pending_batches: number;
  pending_suggestions: number;
  emails_sent_30d: number;
  emails_failed_30d: number;
  success_rate_30d: number;
}

// GET /api/admin/email-hub/metrics - Get email hub dashboard metrics
export async function GET(request: NextRequest) {
  try {
    // Both admin and staff can view metrics
    await requireRole(request, ["admin", "staff"]);

    const metrics = await queryOne<EmailHubMetrics>(`
      SELECT
        (SELECT COUNT(*)::INT FROM trapper.outlook_email_accounts WHERE is_active = TRUE) AS connected_accounts,
        (SELECT COUNT(*)::INT FROM trapper.email_templates WHERE is_active = TRUE) AS active_templates,
        (SELECT COUNT(*)::INT FROM trapper.email_jobs WHERE status IN ('draft', 'queued')) AS pending_jobs,
        (SELECT COUNT(*)::INT FROM trapper.email_batches WHERE status = 'draft') AS pending_batches,
        (SELECT COUNT(*)::INT FROM trapper.email_template_suggestions WHERE status = 'pending') AS pending_suggestions,
        (SELECT COUNT(*)::INT FROM trapper.sent_emails WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '30 days') AS emails_sent_30d,
        (SELECT COUNT(*)::INT FROM trapper.sent_emails WHERE status = 'failed' AND created_at > NOW() - INTERVAL '30 days') AS emails_failed_30d,
        CASE
          WHEN (SELECT COUNT(*) FROM trapper.sent_emails WHERE created_at > NOW() - INTERVAL '30 days') = 0 THEN 100.0
          ELSE ROUND(
            (SELECT COUNT(*) FROM trapper.sent_emails WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '30 days')::numeric /
            NULLIF((SELECT COUNT(*) FROM trapper.sent_emails WHERE created_at > NOW() - INTERVAL '30 days'), 0) * 100,
            1
          )
        END AS success_rate_30d
    `);

    return NextResponse.json({ metrics });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("Error fetching email hub metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch metrics" },
      { status: 500 }
    );
  }
}
