#!/usr/bin/env node
/**
 * Analyze Airtable Trapping Requests for place vs person patterns
 */

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
if (!AIRTABLE_PAT) {
  console.error('ERROR: AIRTABLE_PAT environment variable is required');
  process.exit(1);
}
const BASE_ID = 'appl6zLrRFDvsz0dh';
const TRAPPING_REQUESTS_TABLE = 'tblc1bva7jFzg8DVF';  // Correct table ID

async function fetchAllRecords() {
  const records = [];
  let offset = null;

  while (true) {
    let url = `https://api.airtable.com/v0/${BASE_ID}/${TRAPPING_REQUESTS_TABLE}?pageSize=100`;
    if (offset) url += `&offset=${offset}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Airtable error:', response.status, text);
      throw new Error(`Airtable API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.records) {
      console.error('No records in response:', data);
      break;
    }
    records.push(...data.records);
    console.log(`  Fetched ${records.length} records...`);

    if (data.offset) {
      offset = data.offset;
    } else {
      break;
    }
  }
  return records;
}

function detectPlaceIndicators(name) {
  if (!name) return { score: 0, reasons: [] };

  const reasons = [];
  let score = 0;

  // Strong place indicators
  if (/\b(llc|inc|corp|company|co\.)\b/i.test(name)) {
    reasons.push('corporate');
    score += 3;
  }

  if (/\b(apartment|apts?|community|communities|complex|plaza|estates|manor|village|villas|terrace|towers?|condos?)\b/i.test(name)) {
    reasons.push('housing_complex');
    score += 3;
  }

  if (/\b(hotel|motel|inn|resort|lodge)\b/i.test(name)) {
    reasons.push('hospitality');
    score += 3;
  }

  if (/\b(school|church|hospital|clinic|center|centre)\b/i.test(name)) {
    reasons.push('institution');
    score += 3;
  }

  if (/\b(ranch|farm|winery|vineyard|dairy)\b/i.test(name)) {
    reasons.push('agriculture');
    score += 3;
  }

  // Medium place indicators
  if (/\b(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|court|ct\.?|circle|place|pl\.?)\b/i.test(name)) {
    reasons.push('has_street');
    score += 2;
  }

  // Starts with number (likely address)
  if (/^\d+\s/.test(name)) {
    reasons.push('starts_with_number');
    score += 2;
  }

  // Has comma (like "123 Main St, Santa Rosa")
  if (name.includes(',')) {
    reasons.push('has_comma');
    score += 1;
  }

  // Weak person indicators (subtract score)
  if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(name.trim())) {
    reasons.push('looks_like_person_name');
    score -= 3;
  }

  // Names with "Ms.", "Mr.", "Mrs."
  if (/\b(ms\.?|mr\.?|mrs\.?|dr\.?)\s/i.test(name)) {
    reasons.push('has_honorific');
    score -= 3;
  }

  return { score, reasons };
}

async function main() {
  console.log('Fetching all Trapping Requests...');
  const records = await fetchAllRecords();
  console.log(`Found ${records.length} records\n`);

  const analysis = {
    total: records.length,
    withIsPlace: 0,
    isPlaceTrue: 0,
    isPlaceFalse: 0,
    noIsPlace: 0,
    samples: []
  };

  // Analyze all records
  for (const record of records) {
    const name = record.fields['Name'] || '';
    const isPlace = record.fields['Is Place?'];
    const linkedClients = record.fields['Linked Clients'] || [];
    const locations = record.fields['Locations'] || [];
    const address = record.fields['Address'] || '';

    const indicators = detectPlaceIndicators(name);

    const sample = {
      id: record.id,
      name,
      isPlace,
      linkedClients: linkedClients.length,
      locations: locations.length,
      address: address.substring(0, 50),
      ...indicators
    };

    analysis.samples.push(sample);

    if (isPlace !== undefined && isPlace !== null) {
      analysis.withIsPlace++;
      if (isPlace === 1 || isPlace === true) {
        analysis.isPlaceTrue++;
      } else {
        analysis.isPlaceFalse++;
      }
    } else {
      analysis.noIsPlace++;
    }
  }

  // Summary
  console.log('═══════════════════════════════════════════════════');
  console.log('Summary');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Total records: ${analysis.total}`);
  console.log(`With Is Place? field: ${analysis.withIsPlace}`);
  console.log(`  - Is Place = true: ${analysis.isPlaceTrue}`);
  console.log(`  - Is Place = false: ${analysis.isPlaceFalse}`);
  console.log(`Without Is Place? field: ${analysis.noIsPlace}`);

  // Records marked as places
  console.log('\n═══════════════════════════════════════════════════');
  console.log('Explicitly Marked as PLACES (Is Place? = true)');
  console.log('═══════════════════════════════════════════════════');
  const explicitPlaces = analysis.samples.filter(s => s.isPlace === 1);
  for (const s of explicitPlaces) {
    console.log(`  ${s.name}`);
  }

  // Records without Is Place? field that LOOK like places
  console.log('\n═══════════════════════════════════════════════════');
  console.log('Missing Is Place? but DETECTED as likely place (score >= 2)');
  console.log('═══════════════════════════════════════════════════');
  const detectedPlaces = analysis.samples
    .filter(s => (s.isPlace === undefined || s.isPlace === null) && s.score >= 2)
    .sort((a, b) => b.score - a.score);

  for (const s of detectedPlaces.slice(0, 30)) {
    console.log(`  [score=${s.score}] ${s.name.substring(0, 60).padEnd(60)} ${s.reasons.join(', ')}`);
  }

  // False negatives? (Is Place? = 0 but looks like place)
  console.log('\n═══════════════════════════════════════════════════');
  console.log('Marked as PERSON but detected as PLACE (potential errors)');
  console.log('═══════════════════════════════════════════════════');
  const falseNegatives = analysis.samples
    .filter(s => s.isPlace === 0 && s.score >= 2)
    .sort((a, b) => b.score - a.score);

  for (const s of falseNegatives.slice(0, 20)) {
    console.log(`  [score=${s.score}] ${s.name.substring(0, 60).padEnd(60)} ${s.reasons.join(', ')}`);
  }

  // Records that look like person names
  console.log('\n═══════════════════════════════════════════════════');
  console.log('Sample of likely PERSON names (score <= 0)');
  console.log('═══════════════════════════════════════════════════');
  const likelyPeople = analysis.samples
    .filter(s => s.score <= 0)
    .slice(0, 30);

  for (const s of likelyPeople) {
    const flag = s.isPlace === 1 ? '[PLACE!]' : s.isPlace === 0 ? '[person]' : '[??]';
    console.log(`  ${flag} ${s.name.substring(0, 50).padEnd(50)} ${s.reasons.join(', ')}`);
  }

  // Recommendation
  console.log('\n═══════════════════════════════════════════════════');
  console.log('Detection Rules Recommendation');
  console.log('═══════════════════════════════════════════════════');
  console.log('1. If Is Place? = 1 → PLACE');
  console.log('2. If Is Place? = 0 → PERSON');
  console.log('3. If Is Place? missing and score >= 2 → LIKELY PLACE');
  console.log('4. If Is Place? missing and score <= 0 → LIKELY PERSON');
  console.log('5. If Is Place? missing and 0 < score < 2 → NEEDS REVIEW');
}

main().catch(console.error);
