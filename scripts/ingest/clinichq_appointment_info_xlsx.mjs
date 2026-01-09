#!/usr/bin/env node
/**
 * clinichq_appointment_info_xlsx.mjs
 *
 * Ingests ClinicHQ appointment_info XLSX into trapper.staged_records.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/ingest/clinichq_appointment_info_xlsx.mjs --xlsx /path/to/file.xlsx
 *   node scripts/ingest/clinichq_appointment_info_xlsx.mjs --date 2026-01-09
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { parseXlsxFile } from './_lib/xlsx_reader.mjs';
import {
  IngestRunner,
  detectBaseSuspectIssues,
  colors,
} from './_lib/ingest_run.mjs';

const { Client } = pg;
const { green, red, yellow, cyan, reset, bold } = colors;

// Source identification
const SOURCE_SYSTEM = 'clinichq';
const SOURCE_TABLE = 'appointment_info';

// Default paths
const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH ||
  '/Users/benmisdiaz/Desktop/AI_Ingest';
const DEFAULT_DATE = '2026-01-09';

// ID field candidates
const ID_FIELD_CANDIDATES = [
  'Appointment ID',
  'appointment_id',
  'ID',
  'id',
];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    xlsxPath: null,
    date: DEFAULT_DATE,
    dryRun: false,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--xlsx':
        options.xlsxPath = args[++i];
        break;
      case '--date':
        options.date = args[++i];
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
${bold}ClinicHQ Appointment Info Ingest${reset}
Ingests ClinicHQ appointment_info.xlsx into Atlas staging.

${bold}Usage:${reset}
  node scripts/ingest/clinichq_appointment_info_xlsx.mjs --xlsx /path/to/file.xlsx
  node scripts/ingest/clinichq_appointment_info_xlsx.mjs --date 2026-01-09

${bold}Options:${reset}
  --xlsx <path>   Path to XLSX file
  --date <date>   Date folder to use (default: ${DEFAULT_DATE})
  --dry-run       Parse only, don't write to DB
  --verbose, -v   Show detailed output
  --help, -h      Show this help

${bold}Environment:${reset}
  DATABASE_URL         Postgres connection string (required)
  LOCAL_INGEST_PATH    Base ingest folder
`);
}

function detectSuspectIssues(row) {
  return detectBaseSuspectIssues(row);
}

async function main() {
  const options = parseArgs();
  const startTime = Date.now();

  console.log(`\n${bold}ClinicHQ Appointment Info Ingest${reset}`);
  console.log('═'.repeat(50));

  if (!process.env.DATABASE_URL) {
    console.error(`${red}Error:${reset} DATABASE_URL not set`);
    process.exit(1);
  }

  // Find XLSX file
  let xlsxPath = options.xlsxPath;
  if (!xlsxPath) {
    xlsxPath = path.join(DEFAULT_INGEST_PATH, 'clinichq', options.date, 'appointment_info.xlsx');
  }

  if (!fs.existsSync(xlsxPath)) {
    console.error(`${red}Error:${reset} File not found: ${xlsxPath}`);
    console.log(`${yellow}SKIP:${reset} No appointment_info.xlsx for ${options.date}`);
    process.exit(0);  // Graceful skip
  }

  xlsxPath = path.resolve(xlsxPath);
  const sourceFile = path.basename(xlsxPath);

  console.log(`\n${cyan}Source:${reset} ${xlsxPath}`);
  console.log(`${cyan}Mode:${reset} ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);

  // Parse XLSX
  console.log(`\n${bold}Parsing XLSX...${reset}`);
  const { headers, rows, sheetName } = parseXlsxFile(xlsxPath);
  console.log(`  Sheet: ${sheetName}`);
  console.log(`  Columns: ${headers.length}`);
  console.log(`  Rows: ${rows.length}`);

  if (options.verbose) {
    console.log(`\n${bold}Headers:${reset}`);
    headers.slice(0, 10).forEach((h, i) => console.log(`  ${i + 1}. ${h}`));
    if (headers.length > 10) console.log(`  ... and ${headers.length - 10} more`);
  }

  if (rows.length === 0) {
    console.log(`${yellow}Warning:${reset} No data rows`);
    process.exit(0);
  }

  const stats = {
    total: rows.length,
    inserted: 0,
    skipped: 0,
    linked: 0,
    suspect: 0,
    errors: 0,
    missingId: 0,
  };

  let client = null;
  let runner = null;

  if (!options.dryRun) {
    console.log(`\n${bold}Connecting to database...${reset}`);
    client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      console.log(`  ${green}✓${reset} Connected`);

      runner = new IngestRunner(client, SOURCE_SYSTEM, SOURCE_TABLE, {
        idFieldCandidates: ID_FIELD_CANDIDATES,
        detectSuspect: detectSuspectIssues,
      });

      const runId = await runner.createRun(xlsxPath, rows.length);
      console.log(`  ${green}✓${reset} Created run: ${runId.substring(0, 8)}...`);
    } catch (e) {
      console.error(`  ${red}✗${reset} Connection failed: ${e.message}`);
      process.exit(1);
    }
  }

  console.log(`\n${bold}Ingesting rows...${reset}`);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;

    if (options.dryRun) {
      const issues = detectSuspectIssues(row);
      if (options.verbose) {
        console.log(`  [dry-run] Row ${rowNumber}: issues=${issues.length}`);
      }
      stats.inserted++;
      stats.linked++;
      if (issues.length > 0) stats.suspect++;
      continue;
    }

    const result = await runner.processRow(row, rowNumber, sourceFile, options);

    if (result.error) {
      stats.errors++;
      console.error(`  ${red}!${reset} Row ${rowNumber} error: ${result.error}`);
    } else {
      if (result.wasInserted) {
        stats.inserted++;
        if (options.verbose) console.log(`  ${green}+${reset} Row ${rowNumber}: inserted`);
      } else {
        stats.skipped++;
        if (options.verbose) console.log(`  ${yellow}=${reset} Row ${rowNumber}: exists`);
      }
      stats.linked++;
      if (result.issues.length > 0) stats.suspect++;
      if (!result.sourceRowId) stats.missingId++;
    }
  }

  if (runner) {
    await runner.completeRun(stats);
    await client.end();
  }

  const durationMs = Date.now() - startTime;

  console.log(`\n${bold}Summary${reset}`);
  console.log('─'.repeat(50));
  console.log(`  Total rows:       ${stats.total}`);
  console.log(`  ${green}Inserted:${reset}         ${stats.inserted}`);
  console.log(`  ${yellow}Skipped (dupe):${reset}   ${stats.skipped}`);
  console.log(`  Linked to run:    ${stats.linked}`);
  console.log(`  Suspect rows:     ${stats.suspect}`);
  console.log(`  Missing ID:       ${stats.missingId}`);
  if (stats.errors > 0) console.log(`  ${red}Errors:${reset}           ${stats.errors}`);
  console.log(`  Duration:         ${durationMs}ms`);

  if (options.dryRun) {
    console.log(`\n${yellow}Dry run complete.${reset}`);
  }

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(`${red}Fatal error:${reset}`, e.message);
  process.exit(1);
});
