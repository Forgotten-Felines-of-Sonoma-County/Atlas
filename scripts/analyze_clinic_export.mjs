#!/usr/bin/env node
/**
 * Analyze clinic export data for patterns
 */
import { parseXlsxFile } from './ingest/_lib/xlsx_reader.mjs';

const catInfoPath = '/Users/benmisdiaz/Downloads/report_7728ff6f-34df-4ff8-ac02-d7c9e2d532aa.xlsx';
const apptInfoPath = '/Users/benmisdiaz/Downloads/report_a71b16ba-7cb2-496a-aa43-31a2f64e1091.xlsx';

const catInfo = parseXlsxFile(catInfoPath);
const apptInfo = parseXlsxFile(apptInfoPath);

// Build a map of microchip -> sex from cat_info
const catSex = new Map();
for (const row of catInfo.rows) {
  const chip = row['Microchip Number'];
  const sex = row['Sex'];
  if (chip && sex) catSex.set(chip, sex);
}

console.log('Cat info records:', catInfo.rows.length);
console.log('Unique microchips with sex:', catSex.size);
console.log();

// Check how many appointments can be matched
let matched = 0, unmatched = 0;
let spayNoSex = 0, neuterNoSex = 0;

for (const row of apptInfo.rows) {
  const chip = row['Microchip Number'];
  const service = row['Service / Subsidy'] || '';
  const sex = catSex.get(chip);

  if (sex) {
    matched++;
  } else if (chip) {
    unmatched++;
  }

  const isSpayService = service.toLowerCase().includes('spay');
  const isNeuterService = service.toLowerCase().includes('neuter');

  if (isSpayService && sex === undefined) spayNoSex++;
  if (isNeuterService && sex === undefined) neuterNoSex++;
}

console.log('Appointments matched to cat_info:', matched);
console.log('Appointments NOT matched:', unmatched);
console.log();
console.log('Spay services without sex info:', spayNoSex);
console.log('Neuter services without sex info:', neuterNoSex);
console.log();

// Show sex distribution
const sexCounts = {};
for (const [chip, sex] of catSex) {
  sexCounts[sex] = (sexCounts[sex] || 0) + 1;
}
console.log('Sex distribution in cat_info:');
console.table(sexCounts);
