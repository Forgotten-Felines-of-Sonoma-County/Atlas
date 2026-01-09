#!/usr/bin/env node
/**
 * shelterluv_outcomes_xlsx.mjs - Ingests Shelterluv outcomes XLSX
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { parseXlsxFile } from './_lib/xlsx_reader.mjs';
import { IngestRunner, detectBaseSuspectIssues, colors } from './_lib/ingest_run.mjs';

const { Client } = pg;
const { green, red, yellow, cyan, reset, bold } = colors;

const SOURCE_SYSTEM = 'shelterluv';
const SOURCE_TABLE = 'outcomes';
const DEFAULT_INGEST_PATH = process.env.LOCAL_INGEST_PATH || '/Users/benmisdiaz/Desktop/AI_Ingest';
const DEFAULT_DATE = '2026-01-09';
const ID_FIELD_CANDIDATES = ['Internal-ID', 'Outcome ID', 'ID'];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { xlsxPath: null, date: DEFAULT_DATE, dryRun: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--xlsx': options.xlsxPath = args[++i]; break;
      case '--date': options.date = args[++i]; break;
      case '--dry-run': options.dryRun = true; break;
      case '--verbose': case '-v': options.verbose = true; break;
    }
  }
  return options;
}

function findFile(dateDir) {
  if (!fs.existsSync(dateDir)) return null;
  for (const f of fs.readdirSync(dateDir)) {
    if (/^shelterluv_outcomes.*\.xlsx$/i.test(f)) return path.join(dateDir, f);
  }
  return null;
}

async function main() {
  const options = parseArgs();
  console.log(`\n${bold}Shelterluv Outcomes Ingest${reset}`);
  if (!process.env.DATABASE_URL) { console.error(`${red}Error:${reset} DATABASE_URL not set`); process.exit(1); }

  let xlsxPath = options.xlsxPath || findFile(path.join(DEFAULT_INGEST_PATH, 'shelterluv', options.date));
  if (!xlsxPath || !fs.existsSync(xlsxPath)) {
    console.log(`${yellow}SKIP:${reset} No shelterluv_outcomes file found`);
    process.exit(0);
  }

  const { rows } = parseXlsxFile(xlsxPath);
  console.log(`  ${cyan}Source:${reset} ${xlsxPath}, Rows: ${rows.length}`);
  if (rows.length === 0) { process.exit(0); }

  const stats = { total: rows.length, inserted: 0, skipped: 0, linked: 0, errors: 0 };
  if (options.dryRun) { stats.inserted = stats.linked = rows.length; }
  else {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const runner = new IngestRunner(client, SOURCE_SYSTEM, SOURCE_TABLE, { idFieldCandidates: ID_FIELD_CANDIDATES, detectSuspect: detectBaseSuspectIssues });
    await runner.createRun(xlsxPath, rows.length);
    for (let i = 0; i < rows.length; i++) {
      const result = await runner.processRow(rows[i], i + 2, path.basename(xlsxPath), options);
      if (result.error) stats.errors++; else { if (result.wasInserted) stats.inserted++; else stats.skipped++; stats.linked++; }
    }
    await runner.completeRun(stats);
    await client.end();
  }
  console.log(`  ${bold}Summary:${reset} ${stats.inserted} inserted, ${stats.skipped} skipped`);
  process.exit(stats.errors > 0 ? 1 : 0);
}
main().catch(e => { console.error(`${red}Fatal:${reset}`, e.message); process.exit(1); });
