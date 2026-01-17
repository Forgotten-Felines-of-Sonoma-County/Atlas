import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

export async function GET() {
  try {
    const stats = await queryOne<{
      total_records: number;
      pregnant_count: number;
      lactating_count: number;
      in_heat_count: number;
      unique_cats: number;
    }>(`
      SELECT
        COUNT(*)::INT AS total_records,
        COUNT(*) FILTER (WHERE is_pregnant)::INT AS pregnant_count,
        COUNT(*) FILTER (WHERE is_lactating)::INT AS lactating_count,
        COUNT(*) FILTER (WHERE is_in_heat)::INT AS in_heat_count,
        COUNT(DISTINCT cat_id)::INT AS unique_cats
      FROM trapper.cat_vitals
      WHERE is_pregnant = TRUE OR is_lactating = TRUE OR is_in_heat = TRUE
    `);

    return NextResponse.json(stats || {
      total_records: 0,
      pregnant_count: 0,
      lactating_count: 0,
      in_heat_count: 0,
      unique_cats: 0,
    });
  } catch (error) {
    console.error("Reproduction stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
