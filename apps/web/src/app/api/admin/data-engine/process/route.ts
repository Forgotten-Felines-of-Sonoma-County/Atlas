import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";

/**
 * Data Engine Processing API
 *
 * GET: Return current processing stats
 * POST: Process a batch of records through identity resolution
 */

interface DataEngineStats {
  total_decisions: number;
  auto_matched: number;
  new_entities: number;
  reviews_pending: number;
  total_staged: number;
  remaining: number;
}

interface BatchResult {
  processed: number;
  auto_matched: number;
  new_entities: number;
  reviews_created: number;
  household_members: number;
  rejected: number;
  errors: number;
  duration_ms: number;
}

// GET: Return current stats
export async function GET() {
  try {
    const stats = await queryOne<{
      total_decisions: string;
      auto_matched: string;
      new_entities: string;
      reviews_pending: string;
      total_staged: string;
      remaining: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM trapper.data_engine_match_decisions) as total_decisions,
        (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE decision_type = 'auto_match') as auto_matched,
        (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE decision_type = 'new_entity') as new_entities,
        (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE decision_type = 'review_needed' AND resolved_at IS NULL) as reviews_pending,
        (SELECT COUNT(*) FROM trapper.staged_records) as total_staged,
        (SELECT COUNT(*) FROM trapper.staged_records sr WHERE NOT EXISTS (
          SELECT 1 FROM trapper.data_engine_match_decisions d WHERE d.staged_record_id = sr.id
        )) as remaining
    `, []);

    const result: DataEngineStats = {
      total_decisions: parseInt(stats?.total_decisions || "0"),
      auto_matched: parseInt(stats?.auto_matched || "0"),
      new_entities: parseInt(stats?.new_entities || "0"),
      reviews_pending: parseInt(stats?.reviews_pending || "0"),
      total_staged: parseInt(stats?.total_staged || "0"),
      remaining: parseInt(stats?.remaining || "0"),
    };

    return NextResponse.json({ stats: result });
  } catch (error) {
    console.error("Error fetching Data Engine stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}

// POST: Process a batch
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(body.limit || 50, 100); // Max 100 per batch
    const source = body.source || "clinichq";

    // Validate source
    const validSources = ["clinichq", "airtable", "web_intake"];
    if (!validSources.includes(source)) {
      return NextResponse.json(
        { error: `Invalid source. Must be one of: ${validSources.join(", ")}` },
        { status: 400 }
      );
    }

    // Process batch using the data_engine_process_batch function
    const result = await queryOne<{
      processed: string;
      auto_matched: string;
      new_entities: string;
      reviews_created: string;
      household_members: string;
      rejected: string;
      errors: string;
      duration_ms: string;
    }>(`
      SELECT (r).* FROM (
        SELECT trapper.data_engine_process_batch($1, NULL, $2, NULL) as r
      ) sub
    `, [source, limit]);

    if (!result) {
      return NextResponse.json(
        { error: "No result from processing" },
        { status: 500 }
      );
    }

    const batchResult: BatchResult = {
      processed: parseInt(result.processed || "0"),
      auto_matched: parseInt(result.auto_matched || "0"),
      new_entities: parseInt(result.new_entities || "0"),
      reviews_created: parseInt(result.reviews_created || "0"),
      household_members: parseInt(result.household_members || "0"),
      rejected: parseInt(result.rejected || "0"),
      errors: parseInt(result.errors || "0"),
      duration_ms: parseInt(result.duration_ms || "0"),
    };

    // Get updated stats
    const statsResult = await queryOne<{
      total_decisions: string;
      auto_matched: string;
      new_entities: string;
      reviews_pending: string;
      total_staged: string;
      remaining: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM trapper.data_engine_match_decisions) as total_decisions,
        (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE decision_type = 'auto_match') as auto_matched,
        (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE decision_type = 'new_entity') as new_entities,
        (SELECT COUNT(*) FROM trapper.data_engine_match_decisions WHERE decision_type = 'review_needed' AND resolved_at IS NULL) as reviews_pending,
        (SELECT COUNT(*) FROM trapper.staged_records) as total_staged,
        (SELECT COUNT(*) FROM trapper.staged_records sr WHERE NOT EXISTS (
          SELECT 1 FROM trapper.data_engine_match_decisions d WHERE d.staged_record_id = sr.id
        )) as remaining
    `, []);

    const stats: DataEngineStats = {
      total_decisions: parseInt(statsResult?.total_decisions || "0"),
      auto_matched: parseInt(statsResult?.auto_matched || "0"),
      new_entities: parseInt(statsResult?.new_entities || "0"),
      reviews_pending: parseInt(statsResult?.reviews_pending || "0"),
      total_staged: parseInt(statsResult?.total_staged || "0"),
      remaining: parseInt(statsResult?.remaining || "0"),
    };

    return NextResponse.json({
      success: true,
      result: batchResult,
      stats,
      message: `Processed ${batchResult.processed} records from ${source}`,
    });
  } catch (error) {
    console.error("Error processing Data Engine batch:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Processing failed",
        success: false,
      },
      { status: 500 }
    );
  }
}
