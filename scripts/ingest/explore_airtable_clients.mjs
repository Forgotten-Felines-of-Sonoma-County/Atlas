#!/usr/bin/env node
/**
 * Explore Airtable Clients and Locations tables
 */

const AIRTABLE_PAT = process.env.AIRTABLE_PAT || 'patcjKFzC852FH3sI.ac4874470b704b94ed1545a6d7d67bab536f576d6f3292bdccc9d1eadf635351';
const BASE_ID = 'appl6zLrRFDvsz0dh';

// Known table IDs from the codebase
const TABLES = {
  CLIENTS: 'tbl1tz33y5Jnk76zb',       // Clients table (from previous exploration)
  LOCATIONS: 'tblgIujqp8nISVnfK',      // Locations table
  TRAPPING_REQUESTS: 'tblc1bva7jFzg8DVF'
};

async function fetchRecords(tableId, maxRecords = 100) {
  const records = [];
  let url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?pageSize=${maxRecords}`;

  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Error fetching table ${tableId}:`, response.status, text);
    return [];
  }

  const data = await response.json();
  return data.records || [];
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('Exploring Airtable Structure');
  console.log('═══════════════════════════════════════════════════\n');

  // 1. Explore Clients table
  console.log('1. CLIENTS TABLE');
  console.log('─────────────────────────────────────────────────────');
  const clients = await fetchRecords(TABLES.CLIENTS, 50);
  console.log(`Found ${clients.length} clients (sample)\n`);

  if (clients.length > 0) {
    console.log('Fields available:');
    const allFields = new Set();
    for (const c of clients) {
      Object.keys(c.fields).forEach(k => allFields.add(k));
    }
    for (const f of [...allFields].sort()) {
      console.log(`  - ${f}`);
    }

    console.log('\nSample clients:');
    for (const c of clients.slice(0, 10)) {
      const f = c.fields;
      const name = [f['First Name'], f['Last Name']].filter(Boolean).join(' ') || f['Name'] || '(no name)';
      const email = f['Email'] || '';
      const phone = f['Phone'] || '';
      console.log(`  ${c.id}: ${name.padEnd(25)} ${email.padEnd(30)} ${phone}`);
    }
  }

  // 2. Explore Locations table
  console.log('\n\n2. LOCATIONS TABLE');
  console.log('─────────────────────────────────────────────────────');
  const locations = await fetchRecords(TABLES.LOCATIONS, 50);
  console.log(`Found ${locations.length} locations (sample)\n`);

  if (locations.length > 0) {
    console.log('Fields available:');
    const allFields = new Set();
    for (const l of locations) {
      Object.keys(l.fields).forEach(k => allFields.add(k));
    }
    for (const f of [...allFields].sort()) {
      console.log(`  - ${f}`);
    }

    console.log('\nSample locations:');
    for (const l of locations.slice(0, 10)) {
      const f = l.fields;
      const name = f['Name'] || f['Display Name'] || '(no name)';
      const address = f['Address'] || '';
      console.log(`  ${l.id}: ${name.substring(0, 40).padEnd(40)} ${address.substring(0, 50)}`);
    }
  }

  // 3. Show linked data structure
  console.log('\n\n3. LINKING STRUCTURE');
  console.log('─────────────────────────────────────────────────────');
  console.log('Trapping Request has:');
  console.log('  - Linked Clients: array of Client record IDs');
  console.log('  - Locations: array of Location record IDs');
  console.log('  - Is Place?: boolean (0=person, 1=place)');
  console.log('');
  console.log('When Is Place? = 0:');
  console.log('  -> Linked Clients = the person(s) requesting help');
  console.log('  -> Location = where the cats are');
  console.log('');
  console.log('When Is Place? = 1:');
  console.log('  -> Linked Clients = may be empty or a contact person');
  console.log('  -> Location = the place entity (business/community)');

  // 4. Find place records specifically
  console.log('\n\n4. PLACE-BASED REQUESTS (Is Place? = 1)');
  console.log('─────────────────────────────────────────────────────');
  const requests = await fetchRecords(TABLES.TRAPPING_REQUESTS, 100);
  const placeRequests = requests.filter(r => r.fields['Is Place?'] === 1);
  console.log(`Found ${placeRequests.length} place-based requests\n`);

  for (const r of placeRequests.slice(0, 10)) {
    const f = r.fields;
    const address = f['Address'] || '';
    const linkedClients = f['Linked Clients'] || [];
    const locationIds = f['Locations'] || [];
    console.log(`  ${r.id}:`);
    console.log(`    Address: ${address}`);
    console.log(`    Linked Clients: ${linkedClients.length} (${linkedClients.join(', ')})`);
    console.log(`    Locations: ${locationIds.length} (${locationIds.join(', ')})`);
    console.log('');
  }
}

main().catch(console.error);
