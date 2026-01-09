#!/usr/bin/env node
/**
 * airtable_trapping_requests_csv.mjs
 *
 * Ingests Airtable Trapping Requests CSV into trapper.staged_records
 * Idempotent: re-running with same data inserts 0 new rows
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/airtable_trapping_requests_csv.mjs --csv /path/to/file.csv
 *   node scripts/ingest/airtable_trapping_requests_csv.mjs --csv /path/to/file.csv --dry-run
 *
 * Default CSV location:
 *   $LOCAL_INGEST_PATH/airtable/trapping_requests/*.csv
 *   (or /Users/benmisdiaz/Desktop/AI_Ingest/airtable/trapping_requests/*.csv)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';

const { Client } = pg;

// Source identification
const SOURCE_SYSTEM = 'airtable';
const SOURCE_TABLE = 'trapping_requests';

// Default ingest path
const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH ||
  '/Users/benmisdiaz/Desktop/AI_Ingest';

// Colors for output
const green = '\x1b[32m';
const red = '\x1b[31m';
const yellow = '\x1b[33m';
const cyan = '\x1b[36m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    csvPath: null,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--csv':
        options.csvPath = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
    }
  }

  return options;
}

function printUsage() {
  console.log(`
${bold}Usage:${reset}
  node scripts/ingest/airtable_trapping_requests_csv.mjs --csv /path/to/file.csv

${bold}Options:${reset}
  --csv <path>    Path to CSV file (required)
  --dry-run       Parse and validate only, don't write to DB
  --verbose, -v   Show detailed output
  --help, -h      Show this help

${bold}Environment:${reset}
  DATABASE_URL         Postgres connection string (required)
  LOCAL_INGEST_PATH    Default path for finding CSV files

${bold}Example:${reset}
  set -a && source .env && set +a
  node scripts/ingest/airtable_trapping_requests_csv.mjs \\
    --csv ~/Desktop/AI_Ingest/airtable/trapping_requests/export.csv
`);
}

/**
 * Find most recent CSV if path not specified
 */
function findLatestCsv() {
  const searchDir = path.join(DEFAULT_INGEST_PATH, 'airtable', 'trapping_requests');

  if (!fs.existsSync(searchDir)) {
    return null;
  }

  const files = fs.readdirSync(searchDir)
    .filter(f => f.endsWith('.csv'))
    .map(f => ({
      name: f,
      path: path.join(searchDir, f),
      mtime: fs.statSync(path.join(searchDir, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? files[0].path : null;
}

/**
 * Parse CSV file into array of objects
 * Simple parser that handles quoted fields with commas
 */
function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  if (lines.length < 2) {
    throw new Error('CSV file is empty or has no data rows');
  }

  // Parse header
  const headers = parseCsvLine(lines[0]);

  // Parse data rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);
    const row = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }

    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Compute stable hash of row for idempotency
 * Canonicalizes by:
 * - Sorting keys alphabetically
 * - Trimming whitespace
 * - Lowercasing string values
 * - Removing empty values
 */
function computeRowHash(row) {
  const normalized = {};

  for (const key of Object.keys(row).sort()) {
    let value = row[key];

    if (typeof value === 'string') {
      value = value.trim().toLowerCase();
    }

    // Skip empty values for hash stability
    if (value !== '' && value !== null && value !== undefined) {
      normalized[key] = value;
    }
  }

  const json = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(json).digest('hex').substring(0, 32);
}

/**
 * Extract Airtable record ID from row if present
 * Common column names: 'Record ID', 'Airtable Record ID', 'id', etc.
 */
function extractSourceRowId(row) {
  const idFields = ['Record ID', 'Airtable Record ID', 'record_id', 'id', 'ID'];

  for (const field of idFields) {
    if (row[field] && row[field].trim()) {
      return row[field].trim();
    }
  }

  return null;
}

/**
 * Ingest rows into database
 */
async function ingestRows(client, rows, sourceFile, options) {
  const stats = {
    total: rows.length,
    inserted: 0,
    skipped: 0,
    errors: 0,
  };

  const insertQuery = `
    INSERT INTO trapper.staged_records (
      source_system,
      source_table,
      source_row_id,
      source_file,
      row_hash,
      payload,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    ON CONFLICT (source_system, source_table, row_hash) DO NOTHING
    RETURNING id
  `;

  for (const row of rows) {
    const rowHash = computeRowHash(row);
    const sourceRowId = extractSourceRowId(row);
    const payload = JSON.stringify(row);

    if (options.dryRun) {
      if (options.verbose) {
        console.log(`  [dry-run] Would insert: hash=${rowHash.substring(0, 8)}...`);
      }
      stats.inserted++;
      continue;
    }

    try {
      const result = await client.query(insertQuery, [
        SOURCE_SYSTEM,
        SOURCE_TABLE,
        sourceRowId,
        sourceFile,
        rowHash,
        payload,
      ]);

      if (result.rowCount > 0) {
        stats.inserted++;
        if (options.verbose) {
          console.log(`  ${green}+${reset} Inserted: hash=${rowHash.substring(0, 8)}...`);
        }
      } else {
        stats.skipped++;
        if (options.verbose) {
          console.log(`  ${yellow}=${reset} Skipped (exists): hash=${rowHash.substring(0, 8)}...`);
        }
      }
    } catch (e) {
      stats.errors++;
      console.error(`  ${red}!${reset} Error: ${e.message}`);
    }
  }

  return stats;
}

/**
 * Main entry point
 */
async function main() {
  const options = parseArgs();

  console.log(`\n${bold}Airtable Trapping Requests Ingest${reset}`);
  console.log('═'.repeat(50));

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    console.log('Run: set -a && source .env && set +a');
    process.exit(1);
  }

  // Find CSV file
  let csvPath = options.csvPath || findLatestCsv();

  if (!csvPath) {
    console.error(`${red}Error:${reset} No CSV file specified and none found in default location`);
    console.log(`Expected: ${DEFAULT_INGEST_PATH}/airtable/trapping_requests/*.csv`);
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`${red}Error:${reset} CSV file not found: ${csvPath}`);
    process.exit(1);
  }

  const sourceFile = path.basename(csvPath);
  console.log(`\n${cyan}Source:${reset} ${csvPath}`);
  console.log(`${cyan}Mode:${reset} ${options.dryRun ? 'DRY RUN (no DB writes)' : 'LIVE'}`);

  // Parse CSV
  console.log(`\n${bold}Parsing CSV...${reset}`);
  const { headers, rows } = parseCsv(csvPath);
  console.log(`  Columns: ${headers.length}`);
  console.log(`  Rows: ${rows.length}`);

  if (rows.length === 0) {
    console.log(`${yellow}Warning:${reset} No data rows to ingest`);
    process.exit(0);
  }

  // Show sample row
  if (options.verbose && rows.length > 0) {
    console.log(`\n${bold}Sample row:${reset}`);
    const sample = rows[0];
    for (const key of Object.keys(sample).slice(0, 5)) {
      const val = sample[key].substring(0, 50);
      console.log(`  ${key}: ${val}${sample[key].length > 50 ? '...' : ''}`);
    }
    if (Object.keys(sample).length > 5) {
      console.log(`  ... and ${Object.keys(sample).length - 5} more columns`);
    }
  }

  // Connect to database
  let client = null;
  if (!options.dryRun) {
    console.log(`\n${bold}Connecting to database...${reset}`);
    client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      console.log(`  ${green}✓${reset} Connected`);
    } catch (e) {
      console.error(`  ${red}✗${reset} Connection failed: ${e.message}`);
      process.exit(1);
    }
  }

  // Ingest rows
  console.log(`\n${bold}Ingesting rows...${reset}`);
  const stats = await ingestRows(client, rows, sourceFile, options);

  // Cleanup
  if (client) {
    await client.end();
  }

  // Print summary
  console.log(`\n${bold}Summary${reset}`);
  console.log('─'.repeat(50));
  console.log(`  Total rows:     ${stats.total}`);
  console.log(`  Inserted:       ${green}${stats.inserted}${reset}`);
  console.log(`  Skipped (dupe): ${yellow}${stats.skipped}${reset}`);
  if (stats.errors > 0) {
    console.log(`  Errors:         ${red}${stats.errors}${reset}`);
  }

  if (options.dryRun) {
    console.log(`\n${yellow}Dry run complete. Run without --dry-run to insert.${reset}`);
  } else if (stats.inserted === 0 && stats.skipped > 0) {
    console.log(`\n${cyan}Idempotent: All ${stats.skipped} rows already exist.${reset}`);
  } else if (stats.inserted > 0) {
    console.log(`\n${green}Ingest complete!${reset}`);
    console.log(`\n${bold}Verify with:${reset}`);
    console.log(`  psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM trapper.staged_records WHERE source_table = '${SOURCE_TABLE}'"`);
  }

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(`${red}Fatal error:${reset}`, e.message);
  process.exit(1);
});
