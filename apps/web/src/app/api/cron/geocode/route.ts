import { NextRequest, NextResponse } from "next/server";
import { queryRows, queryOne } from "@/lib/db";

// Geocoding Cron Job
//
// Processes places in the geocoding queue. Run every 5-10 minutes
// to ensure new places get coordinates promptly.
//
// Vercel Cron: Add to vercel.json:
//   "crons": [{ "path": "/api/cron/geocode", "schedule": "every-5-min" }]

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

interface QueuedPlace {
  place_id: string;
  formatted_address: string;
  geocode_attempts: number;
}

export async function GET(request: NextRequest) {
  // Verify this is from Vercel Cron or has valid secret
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");

  if (!cronHeader && CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: "Google API key not configured" },
      { status: 500 }
    );
  }

  const startTime = Date.now();
  const BATCH_LIMIT = 25; // Process 25 places per run

  try {
    // Get places from queue using the existing function
    const queue = await queryRows<QueuedPlace>(
      "SELECT * FROM trapper.get_geocoding_queue($1)",
      [BATCH_LIMIT]
    );

    if (queue.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No places need geocoding",
        processed: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    let successCount = 0;
    let failCount = 0;

    for (const place of queue) {
      try {
        // Call Google Geocoding API
        const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
        url.searchParams.set("address", place.formatted_address);
        url.searchParams.set("key", GOOGLE_API_KEY);

        const response = await fetch(url.toString());
        const data = await response.json();

        if (data.status === "OK" && data.results?.[0]?.geometry?.location) {
          const { lat, lng } = data.results[0].geometry.location;
          const googleFormattedAddress = data.results[0].formatted_address;

          // Record success
          await queryOne(
            "SELECT trapper.record_geocoding_result($1, TRUE, $2, $3, NULL, $4)",
            [place.place_id, lat, lng, googleFormattedAddress]
          );
          successCount++;
        } else {
          // Record failure
          const error = data.status === "ZERO_RESULTS"
            ? "Address not found"
            : data.error_message || data.status || "Unknown error";

          await queryOne(
            "SELECT trapper.record_geocoding_result($1, FALSE, NULL, NULL, $2)",
            [place.place_id, error]
          );
          failCount++;
        }

        // Rate limit - 50ms between requests
        await new Promise((r) => setTimeout(r, 50));
      } catch (err) {
        const error = err instanceof Error ? err.message : "Request failed";
        await queryOne(
          "SELECT trapper.record_geocoding_result($1, FALSE, NULL, NULL, $2)",
          [place.place_id, error]
        );
        failCount++;
      }
    }

    // Get updated stats
    const stats = await queryOne<{
      geocoded: number;
      pending: number;
      failed: number;
    }>("SELECT * FROM trapper.v_geocoding_stats");

    return NextResponse.json({
      success: true,
      message: `Geocoded ${successCount} places, ${failCount} failed`,
      processed: queue.length,
      geocoded: successCount,
      failed: failCount,
      remaining: stats?.pending || 0,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Geocoding cron error:", error);
    return NextResponse.json(
      {
        error: "Geocoding failed",
        message: error instanceof Error ? error.message : "Unknown error",
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
