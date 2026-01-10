import { NextRequest, NextResponse } from "next/server";
import { queryRows, query } from "@/lib/db";

interface SearchResultRow {
  entity_type: string;
  entity_id: string;
  display_name: string;
  subtitle: string | null;
  match_field: string;
  match_value: string;
  rank: number;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const q = searchParams.get("q");
  const entityType = searchParams.get("type");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  if (!q || q.trim().length === 0) {
    return NextResponse.json(
      { error: "Search query 'q' is required" },
      { status: 400 }
    );
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Search term - match against match_value
  conditions.push(`match_value ILIKE $${paramIndex}`);
  params.push(`%${q}%`);
  paramIndex++;

  // Optional entity type filter
  if (entityType && ["cat", "person", "place"].includes(entityType)) {
    conditions.push(`entity_type = $${paramIndex}`);
    params.push(entityType);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  try {
    const sql = `
      SELECT
        entity_type,
        entity_id,
        display_name,
        subtitle,
        match_field,
        match_value,
        rank
      FROM trapper.v_search_unified_v3
      ${whereClause}
      ORDER BY rank ASC, display_name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM trapper.v_search_unified_v3
      ${whereClause}
    `;

    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      queryRows<SearchResultRow>(sql, params),
      query(countSql, params.slice(0, -2)),
    ]);

    return NextResponse.json({
      results: dataResult,
      total: parseInt(countResult.rows[0]?.total || "0", 10),
      limit,
      offset,
      query: q,
    });
  } catch (error) {
    console.error("Error searching:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
