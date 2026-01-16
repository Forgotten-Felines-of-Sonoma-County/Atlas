import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

// Cache stats for 5 minutes - they don't need to be real-time
export const revalidate = 300;

export async function GET() {
  try {
    // Combine all stats into a single efficient query
    const stats = await queryOne<{
      total: number;
      by_status: Record<string, number>;
      by_source: Record<string, number>;
      by_geo_confidence: Record<string, number>;
    }>(`
      WITH status_counts AS (
        SELECT
          COALESCE(submission_status::text, '(none)') as status,
          COUNT(*)::int as cnt
        FROM trapper.web_intake_submissions
        GROUP BY submission_status
      ),
      source_counts AS (
        SELECT
          COALESCE(intake_source::text, '(none)') as source,
          COUNT(*)::int as cnt
        FROM trapper.web_intake_submissions
        GROUP BY intake_source
      ),
      geo_counts AS (
        SELECT
          COALESCE(geo_confidence, '(pending)') as geo,
          COUNT(*)::int as cnt
        FROM trapper.web_intake_submissions
        GROUP BY geo_confidence
      )
      SELECT
        (SELECT COUNT(*)::int FROM trapper.web_intake_submissions) as total,
        (SELECT COALESCE(jsonb_object_agg(status, cnt), '{}') FROM status_counts) as by_status,
        (SELECT COALESCE(jsonb_object_agg(source, cnt), '{}') FROM source_counts) as by_source,
        (SELECT COALESCE(jsonb_object_agg(geo, cnt), '{}') FROM geo_counts) as by_geo_confidence
    `);

    return NextResponse.json({
      total: stats?.total || 0,
      by_status: stats?.by_status || {},
      by_source: stats?.by_source || {},
      by_geo_confidence: stats?.by_geo_confidence || {},
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      }
    });
  } catch (err) {
    console.error("Error fetching admin stats:", err);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
