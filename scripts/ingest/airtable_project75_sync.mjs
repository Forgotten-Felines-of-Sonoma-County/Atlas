#!/usr/bin/env node
/**
 * airtable_project75_sync.mjs
 *
 * Syncs Project 75 post-clinic surveys from Airtable.
 * These are high-confidence colony size observations submitted after clinic visits.
 *
 * Project 75 Data:
 *   - Total cats ("How many cats?")
 *   - Adult/Kitten breakdown
 *   - Already ear-tipped count
 *   - Handleable vs not handleable
 *   - Address where cats are
 *   - Date submitted
 *
 * COLONY SIZE TRACKING (MIG_209):
 * --------------------------------
 * This script populates place_colony_estimates with source_type='post_clinic_survey'.
 * Post-clinic surveys have 85% base confidence as they're recent firsthand observations.
 *
 * Usage:
 *   export $(cat .env | grep -v '^#' | xargs)
 *   node scripts/ingest/airtable_project75_sync.mjs
 *   node scripts/ingest/airtable_project75_sync.mjs --dry-run
 *
 * Required env:
 *   AIRTABLE_PAT - Airtable Personal Access Token
 *   DATABASE_URL - Postgres connection string
 */

import pg from 'pg';
import fs from 'fs';

const { Client } = pg;

// Load env variables from .env (handles special chars in passwords)
function loadEnv() {
  const envContent = fs.readFileSync('.env', 'utf8');
  const vars = {};
  for (const line of envContent.split('\n')) {
    const match = line.match(/^(\w+)=['"]?([^'"]+)['"]?/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

const ENV = loadEnv();
const AIRTABLE_PAT = ENV.AIRTABLE_PAT;
const BASE_ID = 'appl6zLrRFDvsz0dh';
const TABLE_ID = 'tblpjMKadfeunMPq7';  // Project 75

const SOURCE_SYSTEM = 'airtable_project75';

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

async function fetchAllRecords() {
  const records = [];
  let offset = null;
  let page = 1;

  console.log('Fetching Project 75 surveys from Airtable...');

  while (true) {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?pageSize=100`;
    if (offset) {
      url += `&offset=${offset}`;
    }

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Airtable API error: ${response.status} ${response.statusText}\n${text}`);
    }

    const data = await response.json();
    records.push(...data.records);
    console.log(`  Page ${page}: ${data.records.length} records (total: ${records.length})`);

    if (data.offset) {
      offset = data.offset;
      page++;
    } else {
      break;
    }
  }

  return records;
}

// Normalize address for matching
function normalizeAddress(address) {
  if (!address) return null;
  return address
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate string similarity (0-1)
function stringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  const a = s1.toLowerCase();
  const b = s2.toLowerCase();
  if (a === b) return 1;

  // Levenshtein distance
  const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i-1][j] + 1, matrix[i][j-1] + 1, matrix[i-1][j-1] + cost);
    }
  }
  const distance = matrix[a.length][b.length];
  return 1 - (distance / Math.max(a.length, b.length));
}

// Haversine distance in meters
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Geocode address using Google API
async function geocodeAddress(address) {
  const apiKey = ENV.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' || !data.results?.length) return null;

    const result = data.results[0];
    return {
      formattedAddress: result.formatted_address,
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      placeId: result.place_id,
      types: result.types,
      // How well does the formatted result match the input?
      similarity: stringSimilarity(address, result.formatted_address)
    };
  } catch (err) {
    console.error(`  ⚠️ Geocode error: ${err.message}`);
    return null;
  }
}

// Match thresholds
const MATCH_THRESHOLDS = {
  EXACT_ADDRESS: 1.0,       // Normalized address match
  PERSON_MATCH: 0.9,        // Match via requester email/phone
  GEOCODE_NEARBY: 0.8,      // Geocode matches existing place within 100m
  GEOCODE_CREATE: 0.75      // Create new place from high-quality geocode
};

const MAX_DISTANCE_METERS = 100;

async function main() {
  const options = parseArgs();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Project 75 Post-Clinic Survey Sync');
  console.log('═══════════════════════════════════════════════════\n');

  if (!AIRTABLE_PAT) {
    console.error('Error: AIRTABLE_PAT not set');
    process.exit(1);
  }

  if (!ENV.DATABASE_URL) {
    console.error('Error: DATABASE_URL not set');
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  const records = await fetchAllRecords();
  console.log(`\nLoaded ${records.length} Project 75 surveys\n`);

  if (options.dryRun) {
    // Show sample data
    console.log('Sample records:');
    for (const record of records.slice(0, 5)) {
      const f = record.fields;
      console.log(`  ${f['First Name']} ${f['Last Name']} - ${f['Address (where cats are)']}`);
      console.log(`    Cats: ${f['How many cats?']} (${f['Number of Adults']} adults, ${f['Number of Kittens']} kittens)`);
      console.log(`    Ear-tipped: ${f['Already Ear Tipped']}, Need S/N: ${f['Number that Need S/N']}`);
      console.log(`    Date: ${f['Date Submitted'] || f['Submitted Date']}`);
      console.log('');
    }
    console.log('Dry run complete. No changes made.');
    process.exit(0);
  }

  // Connect to database
  const client = new Client({ connectionString: ENV.DATABASE_URL });
  await client.connect();

  // Statistics
  let processed = 0;
  let matchedExact = 0;
  let matchedPerson = 0;
  let matchedGeocode = 0;
  let inserted = 0;
  let updated = 0;
  let skippedNoData = 0;
  let skippedNoMatch = 0;
  let errors = 0;

  for (const record of records) {
    const f = record.fields;
    processed++;

    try {
      const address = f['Address (where cats are)'];
      if (!address) {
        skippedNoData++;
        continue;
      }

      const totalCats = f['How many cats?'];
      if (!totalCats) {
        skippedNoData++;
        continue;
      }

      // Parse date
      let observationDate = null;
      const dateStr = f['Date Submitted'] || f['Submitted Date'];
      if (dateStr) {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          observationDate = parsed.toISOString().split('T')[0];
        }
      }

      // Extract contact info for person lookup
      const email = f['Email'];
      const phone = f['Phone Number']?.replace(/[^\d]/g, '').slice(-10);

      let placeId = null;
      let matchMethod = null;

      // === STRATEGY: GEOCODE FIRST ===
      // Most survey addresses are typed differently than our DB addresses.
      // Geocoding normalizes them to a standard format for matching.

      const geocoded = await geocodeAddress(address);

      if (geocoded) {
        // Normalize geocoded address - remove ", USA" suffix and standardize
        const geoAddr = geocoded.formattedAddress.replace(/, USA$/, '');
        const geoAddrNorm = normalizeAddress(geoAddr);

        // Extract key components for flexible matching
        const streetMatch = geoAddr.match(/^(\d+)\s+(.+?),/);
        const streetNum = streetMatch?.[1];
        const streetName = streetMatch?.[2]?.toLowerCase()
          .replace(/\b(road|rd|street|st|avenue|ave|drive|dr|lane|ln|court|ct|circle|cir|boulevard|blvd|way|place|pl)\b\.?/gi, '')
          .trim();

        // === STEP 1: Exact formatted_address match (with and without USA) ===
        const exactGeoResult = await client.query(`
          SELECT place_id, display_name, formatted_address
          FROM trapper.places
          WHERE formatted_address = $1
             OR formatted_address = $2
             OR formatted_address = $3
          LIMIT 1
        `, [geocoded.formattedAddress, geoAddr, geoAddr + ', USA']);

        if (exactGeoResult.rows.length > 0) {
          placeId = exactGeoResult.rows[0].place_id;
          matchMethod = 'geocode_exact';
          matchedExact++;
          if (options.verbose) {
            console.log(`  ✓ [GEO-EXACT] ${address} → ${exactGeoResult.rows[0].display_name}`);
          }
        }

        // === STEP 1b: Fuzzy address match using key components ===
        if (!placeId && streetNum && streetName) {
          // Match: street number + partial street name + city
          const cityMatch = geoAddr.match(/,\s*([^,]+),\s*CA/);
          const city = cityMatch?.[1]?.toLowerCase();

          const fuzzyResult = await client.query(`
            SELECT place_id, display_name, formatted_address
            FROM trapper.places
            WHERE formatted_address ~* $1
            LIMIT 1
          `, [`^${streetNum}\\s+.*${streetName.slice(0, 8)}.*${city || ''}`]);

          if (fuzzyResult.rows.length > 0) {
            placeId = fuzzyResult.rows[0].place_id;
            matchMethod = 'geocode_fuzzy';
            matchedExact++;
            if (options.verbose) {
              console.log(`  ✓ [GEO-FUZZY] ${address} → ${fuzzyResult.rows[0].display_name}`);
            }
          }
        }

        // === STEP 2: Proximity match with similarity check ===
        if (!placeId) {
          const nearbyResult = await client.query(`
            SELECT place_id, display_name, formatted_address,
                   ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m
            FROM trapper.places
            WHERE location IS NOT NULL
              AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
            ORDER BY distance_m ASC
            LIMIT 3
          `, [geocoded.lng, geocoded.lat, MAX_DISTANCE_METERS]);

          for (const row of nearbyResult.rows) {
            const dbAddr = row.formatted_address || row.display_name;
            const similarity = stringSimilarity(geocoded.formattedAddress, dbAddr);

            // Match if very close (<30m) OR reasonable similarity
            if (row.distance_m < 30 || similarity >= 0.6) {
              placeId = row.place_id;
              matchMethod = 'geocode_nearby';
              matchedGeocode++;
              if (options.verbose) {
                console.log(`  ✓ [GEO-NEARBY] ${address} → ${row.display_name} (${Math.round(row.distance_m)}m, sim=${similarity.toFixed(2)})`);
              }
              break;
            }
          }
        }

        // === STEP 3: Normalized text search (for places without coordinates) ===
        if (!placeId) {
          const geoNorm = normalizeAddress(geocoded.formattedAddress);
          const textResult = await client.query(`
            SELECT place_id, display_name, formatted_address
            FROM trapper.places
            WHERE location IS NULL
              AND (LOWER(REGEXP_REPLACE(formatted_address, '[^\\w\\s]', ' ', 'g')) LIKE $1
                OR LOWER(REGEXP_REPLACE(display_name, '[^\\w\\s]', ' ', 'g')) LIKE $1)
            LIMIT 1
          `, [`%${geoNorm.slice(0, 40)}%`]);

          if (textResult.rows.length > 0) {
            placeId = textResult.rows[0].place_id;
            matchMethod = 'text_match';
            matchedGeocode++;
            if (options.verbose) {
              console.log(`  ✓ [TEXT] ${address} → ${textResult.rows[0].display_name}`);
            }
          }
        }
      }

      // === STEP 4: Person-based match (fallback for failed geocoding) ===
      if (!placeId && (email || phone)) {
        const personResult = await client.query(`
          SELECT r.place_id, pl.display_name, MAX(r.created_at) AS last_request
          FROM trapper.person_identifiers pi
          JOIN trapper.sot_requests r ON r.requester_person_id = pi.person_id
          JOIN trapper.places pl ON pl.place_id = r.place_id
          WHERE (pi.id_type = 'email' AND pi.id_value_norm = LOWER($1))
             OR (pi.id_type = 'phone' AND pi.id_value_norm = $2)
          GROUP BY r.place_id, pl.display_name
          ORDER BY last_request DESC
          LIMIT 1
        `, [email?.toLowerCase(), phone]);

        if (personResult.rows.length > 0) {
          placeId = personResult.rows[0].place_id;
          matchMethod = 'person';
          matchedPerson++;
          if (options.verbose) {
            console.log(`  ✓ [PERSON] ${email || phone} → ${personResult.rows[0].display_name}`);
          }
        }
      }

      // === STEP 5: Raw text match (last resort) ===
      if (!placeId) {
        const addressNorm = normalizeAddress(address);
        const rawResult = await client.query(`
          SELECT place_id, display_name, formatted_address
          FROM trapper.places
          WHERE LOWER(REGEXP_REPLACE(formatted_address, '[^\\w\\s]', ' ', 'g')) LIKE $1
             OR LOWER(REGEXP_REPLACE(display_name, '[^\\w\\s]', ' ', 'g')) LIKE $1
          LIMIT 1
        `, [`%${addressNorm.slice(0, 30)}%`]);

        if (rawResult.rows.length > 0) {
          placeId = rawResult.rows[0].place_id;
          matchMethod = 'raw_text';
          matchedGeocode++;
          if (options.verbose) {
            console.log(`  ✓ [RAW] ${address} → ${rawResult.rows[0].display_name}`);
          }
        }
      }

      if (!placeId) {
        // Could not match - log for manual review
        if (options.verbose) {
          console.log(`  ? [NO MATCH] ${address}`);
        }
        skippedNoMatch++;
        continue;
      }

      // Find or create person (email/phone already extracted above)
      let personId = null;
      const firstName = f['First Name'];
      const lastName = f['Last Name'];

      if (email || phone) {
        const personResult = await client.query(`
          SELECT trapper.find_or_create_person($1, $2, $3, $4, NULL, $5) AS person_id
        `, [email, phone, firstName, lastName, SOURCE_SYSTEM]);
        personId = personResult.rows[0]?.person_id;
      }

      // Extract ecology fields (these may be added to Airtable form later)
      // For now, use total_cats as total_cats_observed for backward compatibility
      const peakCount = f['Peak count (last 7 days)'] || null;
      const eartipCountObserved = f['Ear-tipped cats seen'] || f['Already Ear Tipped'] || null;
      const totalCatsObserved = f['Total cats seen'] || totalCats || null;
      const observationTimeOfDay = f['Observation time'] || null;
      const isAtFeedingStation = f['At feeding station?'] === 'Yes' ? true :
                                  f['At feeding station?'] === 'No' ? false : null;
      const reporterConfidence = f['Confidence'] || null;

      // Upsert colony estimate with ecology fields
      const result = await client.query(`
        INSERT INTO trapper.place_colony_estimates (
          place_id,
          total_cats,
          adult_count,
          kitten_count,
          altered_count,
          unaltered_count,
          friendly_count,
          feral_count,
          peak_count,
          eartip_count_observed,
          total_cats_observed,
          observation_time_of_day,
          is_at_feeding_station,
          reporter_confidence,
          source_type,
          source_entity_type,
          reported_by_person_id,
          observation_date,
          is_firsthand,
          notes,
          source_system,
          source_record_id,
          created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          'post_clinic_survey',
          'survey',
          $15,
          $16,
          TRUE,
          $17,
          $18,
          $19,
          'airtable_project75_sync'
        )
        ON CONFLICT (source_system, source_record_id)
        DO UPDATE SET
          total_cats = EXCLUDED.total_cats,
          adult_count = EXCLUDED.adult_count,
          kitten_count = EXCLUDED.kitten_count,
          altered_count = EXCLUDED.altered_count,
          unaltered_count = EXCLUDED.unaltered_count,
          friendly_count = EXCLUDED.friendly_count,
          feral_count = EXCLUDED.feral_count,
          peak_count = EXCLUDED.peak_count,
          eartip_count_observed = EXCLUDED.eartip_count_observed,
          total_cats_observed = EXCLUDED.total_cats_observed,
          observation_time_of_day = EXCLUDED.observation_time_of_day,
          is_at_feeding_station = EXCLUDED.is_at_feeding_station,
          reporter_confidence = EXCLUDED.reporter_confidence
        RETURNING (xmax = 0) AS was_inserted
      `, [
        placeId,
        totalCats,
        f['Number of Adults'],
        f['Number of Kittens'],
        eartipCountObserved,  // Use as altered_count too
        f['Number that Need S/N'],
        f['Handleable'],
        f['Not handleable'],
        peakCount,
        eartipCountObserved,
        totalCatsObserved,
        observationTimeOfDay,
        isAtFeedingStation,
        reporterConfidence,
        personId,
        observationDate,
        f['Additional info'] || null,
        SOURCE_SYSTEM,
        record.id
      ]);

      if (result.rows[0]?.was_inserted) {
        inserted++;
      } else {
        updated++;
      }

    } catch (err) {
      console.error(`  ✗ Error on record ${record.id}: ${err.message}`);
      errors++;
    }
  }

  await client.end();

  const totalMatched = matchedExact + matchedPerson + matchedGeocode;

  console.log('\n═══════════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`  📋 Processed: ${processed}`);
  console.log(`  🔗 Total matched: ${totalMatched} (${Math.round(100*totalMatched/processed)}%)`);
  console.log(`     ├─ Geocode→exact: ${matchedExact}`);
  console.log(`     ├─ Geocode→nearby/text: ${matchedGeocode}`);
  console.log(`     └─ Person lookup: ${matchedPerson}`);
  console.log(`  ➕ Estimates inserted: ${inserted}`);
  console.log(`  🔄 Estimates updated: ${updated}`);
  console.log(`  ⏭️  Skipped (no data): ${skippedNoData}`);
  console.log(`  ❌ No match found: ${skippedNoMatch}`);
  if (errors > 0) {
    console.log(`  ⚠️  Errors: ${errors}`);
  }
  console.log('═══════════════════════════════════════════════════\n');

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
