import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

interface TrapperRow {
  person_id: string;
  display_name: string;
  trapper_type: string;
  is_ffsc_trapper: boolean;
  active_assignments: number;
  completed_assignments: number;
  total_cats_caught: number;
  total_clinic_cats: number;
  unique_clinic_days: number;
  avg_cats_per_day: number;
  felv_positive_rate_pct: number | null;
  first_activity_date: string | null;
  last_activity_date: string | null;
}

interface AggregateStats {
  total_active_trappers: number;
  ffsc_trappers: number;
  community_trappers: number;
  all_clinic_cats: number;
  all_clinic_days: number;
  avg_cats_per_day_all: number;
  felv_positive_rate_pct_all: number | null;
  all_site_visits: number;
  first_visit_success_rate_pct_all: number | null;
  all_cats_caught: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const type = searchParams.get("type"); // ffsc, community, or all
  const active = searchParams.get("active"); // true to only show active trappers
  const sortBy = searchParams.get("sort") || "total_clinic_cats";
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  try {
    // Build WHERE clause for filtering
    const conditions: string[] = [];
    if (type === "ffsc") {
      conditions.push("is_ffsc_trapper = TRUE");
    } else if (type === "community") {
      conditions.push("is_ffsc_trapper = FALSE");
    }
    // Active filter: show trappers with any activity
    if (active === "true") {
      conditions.push("(active_assignments > 0 OR total_clinic_cats > 0 OR total_cats_caught > 0)");
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Validate sort column to prevent SQL injection
    const validSortColumns = [
      "display_name",
      "trapper_type",
      "active_assignments",
      "completed_assignments",
      "total_cats_caught",
      "total_clinic_cats",
      "unique_clinic_days",
      "avg_cats_per_day",
      "last_activity_date",
    ];
    const orderColumn = validSortColumns.includes(sortBy)
      ? sortBy
      : "total_clinic_cats";

    // Try full stats view first, fallback to basic trapper list
    let trappers: TrapperRow[] = [];
    try {
      trappers = await queryRows<TrapperRow>(
        `SELECT
          person_id,
          display_name,
          trapper_type,
          is_ffsc_trapper,
          active_assignments,
          completed_assignments,
          total_cats_caught,
          total_clinic_cats,
          unique_clinic_days,
          avg_cats_per_day,
          felv_positive_rate_pct,
          first_activity_date,
          last_activity_date
        FROM trapper.v_trapper_full_stats
        ${whereClause}
        ORDER BY ${orderColumn} DESC NULLS LAST
        LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
    } catch (viewError) {
      // Fallback: query person_roles directly if views aren't available
      console.error("v_trapper_full_stats view error, falling back to basic query:", viewError);

      const basicConditions: string[] = ["pr.role = 'trapper'", "pr.role_status = 'active'"];
      if (type === "ffsc") {
        basicConditions.push("pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper')");
      } else if (type === "community") {
        basicConditions.push("pr.trapper_type = 'community_trapper'");
      }
      const basicWhere = `WHERE ${basicConditions.join(" AND ")}`;

      trappers = await queryRows<TrapperRow>(
        `SELECT
          p.person_id,
          p.display_name,
          pr.trapper_type,
          CASE WHEN pr.trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper') THEN TRUE ELSE FALSE END AS is_ffsc_trapper,
          0 AS active_assignments,
          0 AS completed_assignments,
          0 AS total_cats_caught,
          0 AS total_clinic_cats,
          0 AS unique_clinic_days,
          0 AS avg_cats_per_day,
          NULL::NUMERIC AS felv_positive_rate_pct,
          NULL::DATE AS first_activity_date,
          NULL::DATE AS last_activity_date
        FROM trapper.sot_people p
        JOIN trapper.person_roles pr ON pr.person_id = p.person_id
        ${basicWhere}
        ORDER BY p.display_name ASC
        LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
    }

    // Get aggregate statistics (with fallback)
    let aggregates: AggregateStats | null = null;
    try {
      aggregates = await queryOne<AggregateStats>(
        `SELECT * FROM trapper.v_trapper_aggregate_stats`
      );
    } catch {
      // Fallback: compute basic aggregates
      const basicAgg = await queryOne<{ ffsc: number; community: number }>(
        `SELECT
          COUNT(*) FILTER (WHERE trapper_type IN ('coordinator', 'head_trapper', 'ffsc_trapper')) AS ffsc,
          COUNT(*) FILTER (WHERE trapper_type = 'community_trapper') AS community
        FROM trapper.person_roles
        WHERE role = 'trapper' AND role_status = 'active'`
      );
      aggregates = {
        total_active_trappers: (basicAgg?.ffsc || 0) + (basicAgg?.community || 0),
        ffsc_trappers: basicAgg?.ffsc || 0,
        community_trappers: basicAgg?.community || 0,
        all_clinic_cats: 0,
        all_clinic_days: 0,
        avg_cats_per_day_all: 0,
        felv_positive_rate_pct_all: null,
        all_site_visits: 0,
        first_visit_success_rate_pct_all: null,
        all_cats_caught: 0,
      };
    }

    return NextResponse.json({
      trappers,
      aggregates: aggregates || {
        total_active_trappers: 0,
        ffsc_trappers: 0,
        community_trappers: 0,
        all_clinic_cats: 0,
        all_clinic_days: 0,
        avg_cats_per_day_all: 0,
        felv_positive_rate_pct_all: null,
        all_site_visits: 0,
        first_visit_success_rate_pct_all: null,
        all_cats_caught: 0,
      },
      pagination: {
        limit,
        offset,
        hasMore: trappers.length === limit,
      },
    });
  } catch (error) {
    console.error("Error fetching trappers:", error);
    return NextResponse.json(
      { error: "Failed to fetch trappers", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
