import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";

// Entity Linking Cron Job
//
// Runs periodic entity linking operations:
// 1. Creates places from geocoded intake addresses
// 2. Links intake requesters to their places
// 3. Links cats to places via appointment owner contact info
// 4. Links appointments to trappers via email/phone
//
// Run every 15-30 minutes to ensure new submissions get properly linked.
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/entity-linking", "schedule": "every-15-min" }]

export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET;

interface LinkingResult {
  operation: string;
  count: number;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // Run all entity linking operations
    const results = await queryRows<LinkingResult>(
      "SELECT * FROM trapper.run_all_entity_linking()"
    );

    // Build summary
    const summary: Record<string, number> = {};
    let totalLinked = 0;

    for (const row of results) {
      summary[row.operation] = row.count;
      totalLinked += row.count;
    }

    return NextResponse.json({
      success: true,
      message: totalLinked > 0
        ? `Linked ${totalLinked} entities`
        : "No new entities to link",
      results: summary,
      total_linked: totalLinked,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Entity linking cron error:", error);
    return NextResponse.json(
      {
        error: "Entity linking failed",
        details: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

// POST endpoint for manual triggers
export async function POST(request: NextRequest) {
  return GET(request);
}
