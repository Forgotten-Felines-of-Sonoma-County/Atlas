#!/usr/bin/env node
/**
 * Tippy Comprehensive Test Script - Extended Edition
 *
 * Tests Tippy's AI assistant capabilities with realistic staff queries
 * AND edge cases discovered from database data quality analysis:
 * - Regional cat population queries
 * - Address lookups (apartments, PO boxes, rural routes)
 * - Microchip searches (9-digit, alphanumeric, invalid)
 * - Cat name edge cases (single char, placeholders)
 * - Large colony handling (2000+ cats)
 * - Data quality checks
 * - Reminder creation
 * - Lookup saves
 *
 * Usage:
 *   node scripts/test-tippy.mjs [--base-url=http://localhost:3000]
 *   node scripts/test-tippy.mjs --verbose
 *   node scripts/test-tippy.mjs --category=microchip
 *   node scripts/test-tippy.mjs --output=/tmp/tippy-results.json
 *
 * Categories: main, microchip, address, name, colony, data-quality, typo, complex, reminder
 */

import https from 'https';
import http from 'http';
import fs from 'fs';

const BASE_URL = process.argv.find(a => a.startsWith('--base-url='))?.split('=')[1] || 'http://localhost:3000';
let TEST_COOKIE = process.argv.find(a => a.startsWith('--test-cookie='))?.split('=')[1] || '';
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const CATEGORY = process.argv.find(a => a.startsWith('--category='))?.split('=')[1] || 'all';
const OUTPUT_FILE = process.argv.find(a => a.startsWith('--output='))?.split('=')[1];
let SESSION_COOKIES = '';

// ============================================================================
// TEST DATA FROM DATABASE ANALYSIS
// ============================================================================

const TEST_DATA = {
  // Standard microchips
  microchips: {
    standard: ['8003362843', '977200009775871', '981020013830602'],
    // Edge cases from analysis: 9-digit chips, hex alphanumeric
    short: ['019557515', '600028099', '048042259'],
    alphanumeric: ['465C74E4E'],
    invalid: ['000000000', '123', 'NOTACHIP', '999999999999999999']
  },

  // Addresses with various formats
  addresses: {
    standard: [
      '115 Magnolia Avenue, Petaluma',
      '3017 Santa Rosa Ave, Santa Rosa',
      '2834 Apache St, Santa Rosa'
    ],
    // Edge cases: apartments, units, PO boxes
    apartment: [
      '1135 Sunset Dr. #A',
      '101 Boas Dr Unit 34, Santa Rosa',
      '1407 Hendley St Apt. L, Santa Rosa',
      '2555 W Steele Ln Apartment G, Santa Rosa',
      '20285 River Blvd Cabin #7, Monte Rio'
    ],
    poBox: [
      '1050 Fallon-Two Rock Rd POBox 196, Tomales',
      '11672 River Road PO Box 103, Forestville',
      '13990 Highway 1 PO Box 337, Valley Ford'
    ],
    // Addresses with known high cat counts
    highColony: [
      '925 Grand Avenue',
      '3980 Stony Point Rd',
      '3820 Selvage Rd'
    ],
    // Addresses that should trigger geocoding edge cases
    ambiguous: [
      'Main Street',
      'Highway 101',
      '123 Oak St'  // common street name
    ]
  },

  // Cities and regions
  cities: ['Santa Rosa', 'Petaluma', 'Cloverdale', 'Healdsburg', 'Windsor', 'Sebastopol', 'Sonoma', 'Guerneville', 'Forestville', 'Monte Rio'],
  regions: ['west county', 'north county', 'south county', 'east county', 'downtown Santa Rosa', 'Petaluma area', 'wine country', 'coastal area', 'russian river'],

  // Typo variations (tests fuzzy matching)
  typos: {
    cities: {
      'Petulama': 'Petaluma',
      'Santarosa': 'Santa Rosa',
      'Healdberg': 'Healdsburg',
      'Sebastapol': 'Sebastopol',
      'Cloverdale': 'Cloverdale',  // correct spelling
      'Gureneville': 'Guerneville',
      'Winsor': 'Windsor'
    }
  },

  // Cat names found in database (edge cases)
  catNames: {
    singleChar: ['-', '1', 'A', '2', '3'],
    placeholder: ['Unknown (Clinic 981020053869515)', 'Unknown (Petlink 981020053777370)'],
    descriptive: ['Asti Rd male', 'Seb Rd org tabby', 'Sebastopol Rd f blk white kitten'],
    normal: ['Whiskers', 'Mittens', 'Shadow']
  },

  // Data quality issues to test
  dataQuality: {
    alteredStatus: ['spayed', 'neutered', 'Yes', 'No', 'Unknown', 'DidNotAsk'],
    breeds: ['Domestic Short Hair', 'Domestic Shorthair', 'Chihuahua'], // Last one shouldn't be in cat DB
    sex: ['Female', 'Male', 'unknown', null]
  }
};

// ============================================================================
// MAIN QUERY TESTS (15 tests)
// ============================================================================

const MAIN_QUERIES = [
  {
    name: 'Regional cat count - city',
    category: 'main',
    query: `How many cats have we processed in Santa Rosa this year?`,
    expectResponse: /\d+|cat|processed|altered/i
  },
  {
    name: 'Regional cat count - area',
    category: 'main',
    query: `What's the cat population in west county?`,
    expectResponse: /cat|area|colony|population/i
  },
  {
    name: 'Recent activity in area',
    category: 'main',
    query: `We got a call from 2834 Apache St, Santa Rosa. Do we have any recent trappings or anything going on near there?`,
    expectResponse: /request|place|activity|trapping|found|no record/i
  },
  {
    name: 'Active requests in city',
    category: 'main',
    query: `What active requests do we have in Petaluma?`,
    expectResponse: /request|active|progress|\d+/i
  },
  {
    name: 'Request status check',
    category: 'main',
    query: `How many requests are in progress right now?`,
    expectResponse: /\d+|request|progress/i
  },
  {
    name: 'Recent clinic activity',
    category: 'main',
    query: `How many cats did we fix at the clinic last month?`,
    expectResponse: /\d+|cat|clinic|spay|neuter|altered/i
  },
  {
    name: 'Overall TNR stats',
    category: 'main',
    query: `Can you give me a summary of our TNR stats for this year?`,
    expectResponse: /cat|request|total|stats|altered/i
  },
  {
    name: 'Trapper count',
    category: 'main',
    query: `How many active trappers do we have?`,
    expectResponse: /\d+|trapper|active|volunteer/i
  },
  {
    name: 'Completed requests',
    category: 'main',
    query: `How many requests did we complete last month?`,
    expectResponse: /\d+|request|completed|finished/i
  },
  {
    name: 'Colony alteration rate',
    category: 'main',
    query: `What's the average alteration rate across our colonies?`,
    expectResponse: /\d+|percent|alteration|rate|spay|neuter/i
  },
  {
    name: 'Pending intake count',
    category: 'main',
    query: `How many intake submissions are waiting for triage?`,
    expectResponse: /\d+|intake|pending|triage|queue/i
  },
  {
    name: 'Address history lookup',
    category: 'main',
    query: `What's the history at 115 Magnolia Avenue, Petaluma?`,
    expectResponse: /place|address|request|cat|colony|history/i
  },
  {
    name: 'Colony at address',
    category: 'main',
    query: `Is there a colony near 3017 Santa Rosa Ave, Santa Rosa?`,
    expectResponse: /colony|cat|estimate|place|yes|no/i
  },
  {
    name: 'Requester history',
    category: 'main',
    query: `Do we have any history with someone named Smith in Petaluma?`,
    expectResponse: /person|request|history|found|no record/i
  },
  {
    name: 'FFR program info',
    category: 'main',
    query: `What is FFR and how does it work?`,
    expectResponse: /ffr|find|fix|return|tnr|spay|neuter/i
  }
];

// ============================================================================
// MICROCHIP EDGE CASE TESTS (12 tests)
// ============================================================================

const MICROCHIP_QUERIES = [
  // Standard microchip lookups
  {
    name: 'Standard microchip lookup',
    category: 'microchip',
    query: `I got a call about microchip ${TEST_DATA.microchips.standard[0]}. What do we know about it?`,
    expectResponse: /cat|microchip|found|record/i
  },
  {
    name: 'Microchip with appointment request',
    category: 'microchip',
    query: `Can you look up microchip ${TEST_DATA.microchips.standard[1]} and tell me about any appointments?`,
    expectResponse: /cat|appointment|clinic|record/i
  },
  // Short (9-digit) microchips
  {
    name: '9-digit microchip lookup',
    category: 'microchip',
    query: `Look up this chip: ${TEST_DATA.microchips.short[0]}`,
    expectResponse: /cat|microchip|found|record|not found/i,
    edgeCase: 'Short 9-digit microchip format'
  },
  {
    name: 'Another short microchip',
    category: 'microchip',
    query: `Someone called in with chip number ${TEST_DATA.microchips.short[1]}. Is it in the system?`,
    expectResponse: /cat|microchip|found|record|not found/i,
    edgeCase: 'Short microchip format validation'
  },
  // Alphanumeric microchip (hex)
  {
    name: 'Alphanumeric/hex microchip',
    category: 'microchip',
    query: `Can you look up microchip ${TEST_DATA.microchips.alphanumeric[0]}? It might have letters in it.`,
    expectResponse: /cat|microchip|found|record|not found|format/i,
    edgeCase: 'Hexadecimal microchip format (contains letters)'
  },
  // Invalid microchips
  {
    name: 'All zeros microchip',
    category: 'microchip',
    query: `Look up microchip 000000000`,
    expectResponse: /not found|no record|invalid|doesn't exist/i,
    edgeCase: 'Should gracefully handle non-existent chip'
  },
  {
    name: 'Too short microchip',
    category: 'microchip',
    query: `Check chip 123`,
    expectResponse: /not found|invalid|format|too short/i,
    edgeCase: 'Should handle too-short chip numbers'
  },
  {
    name: 'Non-numeric microchip',
    category: 'microchip',
    query: `Look up microchip NOTACHIP`,
    expectResponse: /not found|invalid|format/i,
    edgeCase: 'Should handle non-numeric input'
  },
  {
    name: 'Too long microchip',
    category: 'microchip',
    query: `Look up 999999999999999999`,
    expectResponse: /not found|invalid|format/i,
    edgeCase: 'Should handle too-long chip numbers'
  },
  // Cross-reference queries
  {
    name: 'Microchip to place lookup',
    category: 'microchip',
    query: `Find microchip ${TEST_DATA.microchips.standard[2]} and tell me where the cat lives`,
    expectResponse: /cat|place|address|location|found/i
  },
  {
    name: 'Microchip comparison',
    category: 'microchip',
    query: `I have two possible chips for this cat: ${TEST_DATA.microchips.short[0]} and ${TEST_DATA.microchips.standard[0]}. Can you check both?`,
    expectResponse: /microchip|cat|found|record/i,
    edgeCase: 'Multiple microchip lookup in single query'
  },
  {
    name: 'Raw vs processed microchip',
    category: 'microchip',
    query: `Can you compare the clinic records vs Atlas for microchip ${TEST_DATA.microchips.standard[1]}? Are there any discrepancies?`,
    expectResponse: /cat|microchip|record|clinic|atlas|match|discrepancy/i,
    edgeCase: 'Tests appointment lookup tool comparison'
  }
];

// ============================================================================
// ADDRESS EDGE CASE TESTS (15 tests)
// ============================================================================

const ADDRESS_QUERIES = [
  // Apartment/Unit variations
  {
    name: 'Address with #A unit',
    category: 'address',
    query: `Look up ${TEST_DATA.addresses.apartment[0]}`,
    expectResponse: /place|address|cat|found|no record/i,
    edgeCase: 'Unit number with # symbol'
  },
  {
    name: 'Address with Unit number',
    category: 'address',
    query: `What's the history at ${TEST_DATA.addresses.apartment[1]}?`,
    expectResponse: /place|address|history|cat/i,
    edgeCase: 'Unit number spelled out'
  },
  {
    name: 'Address with Apt abbreviation',
    category: 'address',
    query: `Check ${TEST_DATA.addresses.apartment[2]}`,
    expectResponse: /place|address|cat|found/i,
    edgeCase: 'Apt. abbreviation with period'
  },
  {
    name: 'Address with Apartment spelled out',
    category: 'address',
    query: `Any cats at ${TEST_DATA.addresses.apartment[3]}?`,
    expectResponse: /cat|place|found|no record/i,
    edgeCase: 'Full word Apartment'
  },
  {
    name: 'Address with Cabin unit',
    category: 'address',
    query: `Look up ${TEST_DATA.addresses.apartment[4]}`,
    expectResponse: /place|cabin|cat|found/i,
    edgeCase: 'Cabin as unit type'
  },
  // PO Box addresses
  {
    name: 'Address with PO Box',
    category: 'address',
    query: `What do we have for ${TEST_DATA.addresses.poBox[0]}?`,
    expectResponse: /place|po box|address|can't geocode|found/i,
    edgeCase: 'PO Box cannot be geocoded'
  },
  {
    name: 'Rural address with PO Box',
    category: 'address',
    query: `Check ${TEST_DATA.addresses.poBox[1]}`,
    expectResponse: /place|address|found|rural/i,
    edgeCase: 'Rural route with PO Box'
  },
  {
    name: 'Highway address with PO Box',
    category: 'address',
    query: `Any history at ${TEST_DATA.addresses.poBox[2]}?`,
    expectResponse: /place|highway|address|found/i,
    edgeCase: 'Highway address format'
  },
  // High colony addresses
  {
    name: 'Large colony address - Grand Ave',
    category: 'address',
    query: `How many cats are at ${TEST_DATA.addresses.highColony[0]}?`,
    expectResponse: /\d+|cat|colony|many|large/i,
    edgeCase: 'Address with 2000+ cats - tests query performance'
  },
  {
    name: 'Large colony - Stony Point',
    category: 'address',
    query: `Tell me about the colony at ${TEST_DATA.addresses.highColony[1]}`,
    expectResponse: /cat|colony|altered|place/i,
    edgeCase: 'Large colony with 150+ cats'
  },
  {
    name: 'Large colony - Selvage',
    category: 'address',
    query: `What's the alteration rate at ${TEST_DATA.addresses.highColony[2]}?`,
    expectResponse: /\d+|percent|altered|rate/i,
    edgeCase: 'Alteration rate calculation for large colony'
  },
  // Ambiguous addresses
  {
    name: 'Ambiguous street name',
    category: 'address',
    query: `How many cats on Main Street?`,
    expectResponse: /main street|multiple|which|cats|places/i,
    edgeCase: 'Common street name - should handle multiple matches'
  },
  {
    name: 'Highway address without city',
    category: 'address',
    query: `Any colonies on Highway 101?`,
    expectResponse: /highway|101|colony|places|multiple/i,
    edgeCase: 'Highway without city - ambiguous'
  },
  {
    name: 'Partial address',
    category: 'address',
    query: `Look up 123 Oak St`,
    expectResponse: /oak|address|clarify|which city|found/i,
    edgeCase: 'Missing city - should ask for clarification or show options'
  },
  {
    name: 'Address normalization test',
    category: 'address',
    query: `Check 3584 moorland ave santa rosa (note: lowercase)`,
    expectResponse: /moorland|place|cat|found/i,
    edgeCase: 'Lowercase address - tests normalization'
  }
];

// ============================================================================
// CAT NAME EDGE CASE TESTS (8 tests)
// ============================================================================

const CAT_NAME_QUERIES = [
  {
    name: 'Single character cat name',
    category: 'name',
    query: `Is there a cat named "-" in the system?`,
    expectResponse: /cat|found|name|record/i,
    edgeCase: '343 cats named "-" exist - placeholder detection'
  },
  {
    name: 'Numeric cat name',
    category: 'name',
    query: `Look up cats named "1"`,
    expectResponse: /cat|found|name/i,
    edgeCase: 'Numeric name - likely placeholder'
  },
  {
    name: 'Clinic reference name',
    category: 'name',
    query: `Find the cat named "Unknown (Clinic 981020053869515)"`,
    expectResponse: /cat|unknown|clinic|found/i,
    edgeCase: 'Cat name contains microchip reference'
  },
  {
    name: 'Location-based cat name',
    category: 'name',
    query: `Look up "Asti Rd male"`,
    expectResponse: /cat|found|asti/i,
    edgeCase: 'Cat named after location - exists at 46 places'
  },
  {
    name: 'Description as cat name',
    category: 'name',
    query: `Find the cat called "Sebastopol Rd f blk white kitten"`,
    expectResponse: /cat|found|sebastopol/i,
    edgeCase: 'Full description used as name'
  },
  {
    name: 'Normal cat name search',
    category: 'name',
    query: `Are there any cats named Whiskers?`,
    expectResponse: /cat|whiskers|found|no record/i
  },
  {
    name: 'Cat with special characters in name',
    category: 'name',
    query: `Look up a cat named "O'Malley"`,
    expectResponse: /cat|found|name/i,
    edgeCase: 'Apostrophe in name'
  },
  {
    name: 'Very long cat name',
    category: 'name',
    query: `Is there a cat with a really long name like "FFSC, McDonalds Healdsburg Colony"?`,
    expectResponse: /cat|found|name/i,
    edgeCase: 'Name over 50 characters'
  }
];

// ============================================================================
// TYPO AND FUZZY MATCHING TESTS (7 tests)
// ============================================================================

const TYPO_QUERIES = [
  {
    name: 'Typo: Petulama',
    category: 'typo',
    query: `Cats in Petulama area?`,
    expectResponse: /petaluma|cat|colony|area/i,
    edgeCase: 'Common misspelling of Petaluma'
  },
  {
    name: 'Typo: Santarosa',
    category: 'typo',
    query: `How many requests in Santarosa?`,
    expectResponse: /santa rosa|request|\d+/i,
    edgeCase: 'Missing space in Santa Rosa'
  },
  {
    name: 'Typo: Healdberg',
    category: 'typo',
    query: `Active colonies near Healdberg?`,
    expectResponse: /healdsburg|colony|found/i,
    edgeCase: 'Misspelled Healdsburg'
  },
  {
    name: 'Typo: Sebastapol',
    category: 'typo',
    query: `Trappers working in Sebastapol today?`,
    expectResponse: /sebastopol|trapper|working/i,
    edgeCase: 'Common Sebastopol misspelling'
  },
  {
    name: 'Typo: Gureneville',
    category: 'typo',
    query: `Any cats fixed in Gureneville last month?`,
    expectResponse: /guerneville|cat|fixed|altered/i,
    edgeCase: 'Misspelled Guerneville'
  },
  {
    name: 'Case insensitive city',
    category: 'typo',
    query: `colonies in SANTA ROSA (all caps)`,
    expectResponse: /santa rosa|colony/i,
    edgeCase: 'All caps city name'
  },
  {
    name: 'Mixed case with typo',
    category: 'typo',
    query: `windSOR area cats`,
    expectResponse: /windsor|cat|area/i,
    edgeCase: 'Mixed case and variations'
  }
];

// ============================================================================
// DATA QUALITY QUERIES (10 tests)
// ============================================================================

const DATA_QUALITY_QUERIES = [
  {
    name: 'Cats without microchip',
    category: 'data-quality',
    query: `How many cats don't have a microchip registered?`,
    expectResponse: /cat|\d+|microchip|missing|none/i,
    edgeCase: 'NULL microchip detection'
  },
  {
    name: 'Cats with unknown sex',
    category: 'data-quality',
    query: `How many cats have unknown sex in the database?`,
    expectResponse: /\d+|cat|unknown|sex|gender/i,
    edgeCase: '1707 cats have NULL sex'
  },
  {
    name: 'Cats with unknown altered status',
    category: 'data-quality',
    query: `How many cats have unknown spay/neuter status?`,
    expectResponse: /\d+|cat|unknown|altered|spay|neuter/i,
    edgeCase: '1718 cats have NULL altered_status'
  },
  {
    name: 'Places without geocoding',
    category: 'data-quality',
    query: `Are there addresses that haven't been geocoded yet?`,
    expectResponse: /\d+|place|address|geocod|location|pending/i,
    edgeCase: '182 places have NULL location'
  },
  {
    name: 'Requests missing dates',
    category: 'data-quality',
    query: `Are there completed requests that don't have a resolved date?`,
    expectResponse: /request|completed|resolved|date|missing/i,
    edgeCase: 'All 277 requests have NULL resolved_at'
  },
  {
    name: 'Merged people count',
    category: 'data-quality',
    query: `How many duplicate person records have been merged?`,
    expectResponse: /\d+|person|merged|duplicate/i,
    edgeCase: '14,241 merged into 3,648'
  },
  {
    name: 'Merged places count',
    category: 'data-quality',
    query: `How many address duplicates have been consolidated?`,
    expectResponse: /\d+|place|address|merged|duplicate/i,
    edgeCase: '2,553 places merged'
  },
  {
    name: 'Non-cat breeds in database',
    category: 'data-quality',
    query: `Are there any dogs accidentally in the cat database?`,
    expectResponse: /chihuahua|dog|cat|breed|error|no/i,
    edgeCase: '11 Chihuahuas in cat database'
  },
  {
    name: 'Inconsistent altered status values',
    category: 'data-quality',
    query: `What different values are used for spay/neuter status in the system?`,
    expectResponse: /spayed|neutered|yes|no|unknown|status/i,
    edgeCase: '9 different values exist'
  },
  {
    name: 'Test email addresses',
    category: 'data-quality',
    query: `Are there any test or demo email addresses in the system?`,
    expectResponse: /test|demo|email|example|admin/i,
    edgeCase: '21 test emails exist'
  }
];

// ============================================================================
// COMPLEX MULTI-PART QUERIES (8 tests)
// ============================================================================

const COMPLEX_QUERIES = [
  {
    name: 'Multi-city stats',
    category: 'complex',
    query: `Compare the cat counts between Santa Rosa and Petaluma. Which has more colonies?`,
    expectResponse: /santa rosa|petaluma|cat|colony|\d+|more/i,
    edgeCase: 'Cross-city comparison'
  },
  {
    name: 'Address + reminder combo',
    category: 'complex',
    query: `Look up 3017 Santa Rosa Ave, and if there are cats there, remind me to check on them next week`,
    expectResponse: /santa rosa|cat|remind|place/i,
    edgeCase: 'Query + action in one request',
    requiresWriteAccess: true
  },
  {
    name: 'Multi-step data research',
    category: 'complex',
    query: `Find all the places on Selvage Rd, count the total cats, calculate the alteration rate, and save this to my lookups`,
    expectResponse: /selvage|cat|rate|lookup|saved/i,
    edgeCase: 'Multi-step research and save',
    requiresWriteAccess: true
  },
  {
    name: 'Time range comparison',
    category: 'complex',
    query: `How does our cat count this month compare to last month in Santa Rosa?`,
    expectResponse: /\d+|month|compare|cat|increase|decrease/i,
    edgeCase: 'Time-based comparison'
  },
  {
    name: 'Conditional query',
    category: 'complex',
    query: `If the alteration rate at 115 Magnolia Avenue is below 70%, tell me what we need to do to improve it`,
    expectResponse: /magnolia|alteration|rate|percent|improve|goal/i,
    edgeCase: 'Conditional logic in query'
  },
  {
    name: 'Microchip + address cross-reference',
    category: 'complex',
    query: `I found microchip 977200009775871 at 3017 Santa Rosa Ave. Does that match our records?`,
    expectResponse: /microchip|santa rosa|match|cat|record/i,
    edgeCase: 'Cross-referencing two lookups'
  },
  {
    name: 'Three-part query',
    category: 'complex',
    query: `How many cats in Petaluma, how many requests are pending there, and who are the active trappers in that area?`,
    expectResponse: /petaluma|cat|request|trapper/i,
    edgeCase: 'Three separate data points in one query'
  },
  {
    name: 'Historical trend query',
    category: 'complex',
    query: `Show me the trend of cats fixed in Sonoma County over the past year by month`,
    expectResponse: /\d+|month|trend|cat|fixed|year/i,
    edgeCase: 'Time series data request'
  }
];

// ============================================================================
// REMINDER AND LOOKUP TESTS (5 tests)
// ============================================================================

const REMINDER_QUERIES = [
  {
    name: 'Basic reminder creation',
    category: 'reminder',
    query: `Remind me to follow up on the 115 Magnolia Avenue request next week`,
    expectResponse: /reminder|created|follow up|week/i,
    requiresWriteAccess: true
  },
  {
    name: 'Reminder with specific time',
    category: 'reminder',
    query: `Set a reminder for tomorrow at 9am to check on cats in Cloverdale`,
    expectResponse: /reminder|created|tomorrow|cloverdale/i,
    requiresWriteAccess: true
  },
  {
    name: 'Research and save lookup',
    category: 'reminder',
    query: `Find info on 686 South Cloverdale Boulevard, Cloverdale and save to my lookups`,
    expectResponse: /saved|lookup|cloverdale|found/i,
    requiresWriteAccess: true
  },
  {
    name: 'Reminder with entity link',
    category: 'reminder',
    query: `Remind me to update the colony estimate at 3980 Stony Point Rd in 3 days`,
    expectResponse: /reminder|created|colony|stony point/i,
    requiresWriteAccess: true
  },
  {
    name: 'Save multi-place research',
    category: 'reminder',
    query: `Research all the colonies on Highway 116 near Sebastopol and save the findings to my lookups for my weekly report`,
    expectResponse: /saved|lookup|highway|sebastopol|research/i,
    requiresWriteAccess: true
  }
];

// ============================================================================
// VAGUE AND CLARIFICATION TESTS (5 tests)
// ============================================================================

const VAGUE_QUERIES = [
  {
    name: 'Completely vague request',
    category: 'vague',
    query: `Tell me about the cats`,
    expectResponse: /.+/i,  // Any response is OK
    edgeCase: 'Should ask for clarification or provide overview'
  },
  {
    name: 'Ambiguous location',
    category: 'vague',
    query: `What's happening on Oak Street?`,
    expectResponse: /oak|which|multiple|clarify|found/i,
    edgeCase: 'Multiple Oak Streets exist'
  },
  {
    name: 'Unclear time reference',
    category: 'vague',
    query: `What did we do recently?`,
    expectResponse: /recent|request|activity|day|week/i,
    edgeCase: 'Unclear time period'
  },
  {
    name: 'Pronoun without antecedent',
    category: 'vague',
    query: `Can you check on them?`,
    expectResponse: /who|which|clarify|what/i,
    edgeCase: 'No clear reference'
  },
  {
    name: 'Unrelated topic',
    category: 'vague',
    query: `What's the weather like in Sonoma County?`,
    expectResponse: /can't|weather|help with|cats|tnr|atlas/i,
    edgeCase: 'Out of scope question - should redirect politely'
  }
];

// ============================================================================
// ALL TESTS COMBINED
// ============================================================================

const ALL_QUERY_GROUPS = {
  main: { name: 'Main Query Tests', queries: MAIN_QUERIES },
  microchip: { name: 'Microchip Edge Cases', queries: MICROCHIP_QUERIES },
  address: { name: 'Address Edge Cases', queries: ADDRESS_QUERIES },
  name: { name: 'Cat Name Edge Cases', queries: CAT_NAME_QUERIES },
  typo: { name: 'Typo & Fuzzy Matching', queries: TYPO_QUERIES },
  'data-quality': { name: 'Data Quality Queries', queries: DATA_QUALITY_QUERIES },
  complex: { name: 'Complex Multi-Part', queries: COMPLEX_QUERIES },
  reminder: { name: 'Reminders & Lookups', queries: REMINDER_QUERIES },
  vague: { name: 'Vague & Clarification', queries: VAGUE_QUERIES }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function login() {
  console.log('Logging in as test@forgottenfelines.com...');
  const response = await makeRequest(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: {
      email: 'test@forgottenfelines.com',
      password: 'testpass123'
    }
  });

  if (response.status === 200 && response.data.success) {
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      SESSION_COOKIES = Array.isArray(setCookie)
        ? setCookie.map(c => c.split(';')[0]).join('; ')
        : setCookie.split(';')[0];
      console.log('Login successful! Session established.\n');
      return true;
    }
  }
  console.log('Login failed:', response.data);
  return false;
}

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;

    const urlObj = new URL(url);
    const cookies = SESSION_COOKIES || TEST_COOKIE;
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(cookies ? { 'Cookie': cookies } : {}),
        ...options.headers
      }
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data),
            headers: res.headers
          });
        } catch {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function testTippyQuery(test) {
  const startTime = Date.now();

  try {
    const response = await makeRequest(`${BASE_URL}/api/tippy/chat`, {
      method: 'POST',
      body: { message: test.query }
    });

    const elapsed = Date.now() - startTime;

    if (response.status === 401) {
      return { status: 'skip', reason: 'unauthorized', elapsed };
    }

    if (response.status === 403) {
      if (test.requiresWriteAccess) {
        return { status: 'expected_forbidden', elapsed };
      }
      return { status: 'error', reason: 'forbidden', elapsed };
    }

    if (response.status !== 200) {
      return { status: 'error', httpStatus: response.status, elapsed };
    }

    const data = response.data;
    const responseText = data.response || data.message || '';
    const toolsUsed = (data.toolResults || []).map(tr => tr.toolName);

    // Validate response
    let passed = true;
    const issues = [];

    if (test.expectResponse && !test.expectResponse.test(responseText)) {
      issues.push(`Response doesn't match expected pattern`);
      passed = false;
    }

    if (responseText.length < 10 && !test.expectShortResponse) {
      issues.push(`Response too short (${responseText.length} chars)`);
      passed = false;
    }

    return {
      status: passed ? 'pass' : 'warning',
      elapsed,
      toolsUsed,
      responseLength: responseText.length,
      responsePreview: responseText.slice(0, 200),
      issues
    };

  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

function printTestResult(test, result) {
  const statusIcons = {
    pass: '✓',
    warning: '⚠',
    error: '✗',
    skip: '○',
    expected_forbidden: '⊘'
  };

  const statusColors = {
    pass: '\x1b[32m',
    warning: '\x1b[33m',
    error: '\x1b[31m',
    skip: '\x1b[90m',
    expected_forbidden: '\x1b[36m'
  };

  const icon = statusIcons[result.status] || '?';
  const color = statusColors[result.status] || '';
  const reset = '\x1b[0m';

  console.log(`${color}${icon}${reset} ${test.name} (${result.elapsed || 0}ms)`);

  if (VERBOSE) {
    console.log(`   Query: "${test.query.slice(0, 60)}${test.query.length > 60 ? '...' : ''}"`);
    if (test.edgeCase) {
      console.log(`   Edge case: ${test.edgeCase}`);
    }
    if (result.toolsUsed?.length > 0) {
      console.log(`   Tools: ${result.toolsUsed.join(', ')}`);
    }
    if (result.responsePreview) {
      console.log(`   Response: "${result.responsePreview.slice(0, 100)}..."`);
    }
    if (result.issues?.length > 0) {
      result.issues.forEach(i => console.log(`   Issue: ${i}`));
    }
    console.log('');
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runTestSuite() {
  console.log('\n' + '█'.repeat(70));
  console.log('  TIPPY COMPREHENSIVE TEST SUITE - EXTENDED EDITION');
  console.log('█'.repeat(70));
  console.log(`\nBase URL: ${BASE_URL}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Category: ${CATEGORY}`);

  // Login
  console.log('\n--- Authenticating ---');
  const loggedIn = await login();
  if (!loggedIn) {
    console.log('WARNING: Running without authentication. Write features will not work.');
  }

  const results = {
    pass: 0, warning: 0, error: 0, skip: 0, expected_forbidden: 0,
    details: [],
    byCategory: {}
  };

  // Determine which groups to run
  const groupsToRun = CATEGORY === 'all'
    ? Object.entries(ALL_QUERY_GROUPS)
    : Object.entries(ALL_QUERY_GROUPS).filter(([key]) => key === CATEGORY);

  let totalTests = groupsToRun.reduce((sum, [, group]) => sum + group.queries.length, 0);
  console.log(`Total tests: ${totalTests}\n`);

  // Run each group
  for (const [key, group] of groupsToRun) {
    console.log('\n' + '─'.repeat(70));
    console.log(`${group.name.toUpperCase()} (${group.queries.length} tests)`);
    console.log('─'.repeat(70) + '\n');

    results.byCategory[key] = { pass: 0, warning: 0, error: 0 };

    for (const test of group.queries) {
      const result = await testTippyQuery(test);
      results[result.status] = (results[result.status] || 0) + 1;
      results.byCategory[key][result.status] = (results.byCategory[key][result.status] || 0) + 1;
      results.details.push({ name: test.name, category: key, ...result });

      printTestResult(test, result);

      // Small delay between requests
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Summary
  console.log('\n\n' + '█'.repeat(70));
  console.log('  TEST SUMMARY');
  console.log('█'.repeat(70));

  console.log(`\n  Passed:           ${results.pass}`);
  console.log(`  Warnings:         ${results.warning}`);
  console.log(`  Errors:           ${results.error}`);
  console.log(`  Skipped:          ${results.skip}`);
  console.log(`  Expected 403:     ${results.expected_forbidden}`);
  console.log(`  Total:            ${results.details.length}`);

  // Response time stats
  const times = results.details.filter(d => d.elapsed).map(d => d.elapsed);
  if (times.length > 0) {
    console.log(`\n  Response times:`);
    console.log(`    Min:    ${Math.min(...times)}ms`);
    console.log(`    Max:    ${Math.max(...times)}ms`);
    console.log(`    Avg:    ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms`);
  }

  // Category breakdown
  console.log(`\n  By Category:`);
  for (const [key, stats] of Object.entries(results.byCategory)) {
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    console.log(`    ${key}: ${stats.pass || 0}/${total} passed`);
  }

  // Issues summary
  const issues = results.details.filter(d => d.issues?.length > 0 || d.status === 'error');
  if (issues.length > 0) {
    console.log(`\n  Issues Found (${issues.length}):`);
    issues.slice(0, 10).forEach(d => {
      console.log(`    - ${d.name}: ${d.issues?.[0] || d.reason || d.error || 'Unknown'}`);
    });
    if (issues.length > 10) {
      console.log(`    ... and ${issues.length - 10} more`);
    }
  }

  console.log('\n' + '█'.repeat(70) + '\n');

  // Output to file if requested
  if (OUTPUT_FILE) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    console.log(`Results saved to: ${OUTPUT_FILE}\n`);
  }

  return results;
}

// Run the test suite
runTestSuite().catch(console.error);
