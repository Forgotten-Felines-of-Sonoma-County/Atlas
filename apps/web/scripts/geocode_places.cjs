#!/usr/bin/env node

/**
 * Batch Geocode Places
 * Run from apps/web: node scripts/geocode_places.cjs [--limit N]
 */

const pg = require("pg");
const fs = require("fs");
const path = require("path");

// Load .env manually (Next.js doesn't include dotenv as a dep)
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    // Skip comments and empty lines
    if (!line || line.startsWith("#")) return;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) return;
    const key = line.substring(0, eqIdx).trim();
    let value = line.substring(eqIdx + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error("ERROR: GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY not set");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function geocodeAddress(address) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", GOOGLE_API_KEY);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status === "OK" && data.results && data.results.length > 0) {
    const location = data.results[0].geometry.location;
    return { success: true, lat: location.lat, lng: location.lng };
  }

  return { success: false, error: data.status || "Unknown" };
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 50;

  console.log("Batch Geocode Places");
  console.log("====================");
  console.log("Limit:", limit);
  console.log("");

  // Get count
  const countResult = await pool.query(
    "SELECT COUNT(*) as count FROM trapper.places WHERE location IS NULL AND formatted_address IS NOT NULL AND formatted_address != ''"
  );
  console.log("Total needing geocoding:", countResult.rows[0].count);

  // Get batch
  const result = await pool.query(
    "SELECT place_id, display_name, formatted_address FROM trapper.places WHERE location IS NULL AND formatted_address IS NOT NULL AND formatted_address != '' LIMIT $1",
    [limit]
  );

  console.log("Processing:", result.rows.length);
  console.log("");

  if (result.rows.length === 0) {
    console.log("All places have coordinates!");
    await pool.end();
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (const place of result.rows) {
    const addr = (place.formatted_address || "").substring(0, 50).padEnd(50);
    process.stdout.write("Geocoding: " + addr + " ");

    const geo = await geocodeAddress(place.formatted_address);

    if (geo.success) {
      await pool.query(
        "UPDATE trapper.places SET location = ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, updated_at = NOW() WHERE place_id = $3",
        [geo.lat, geo.lng, place.place_id]
      );
      console.log("OK (" + geo.lat.toFixed(4) + ", " + geo.lng.toFixed(4) + ")");
      successCount++;
    } else {
      console.log("FAIL:", geo.error);
      failCount++;
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log("");
  console.log("Summary: Success=" + successCount + ", Failed=" + failCount);

  // Check remaining
  const remaining = await pool.query(
    "SELECT COUNT(*) as count FROM trapper.places WHERE location IS NULL AND formatted_address IS NOT NULL AND formatted_address != ''"
  );
  console.log("Remaining:", remaining.rows[0].count);

  await pool.end();
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
