/**
 * Tippy Edge Case Question Bank
 *
 * Tests how Tippy handles problematic data conditions:
 * - Missing data (incomplete records)
 * - Conflicting data (different values across sources)
 * - Merge chains (multi-hop entity relationships)
 *
 * All tests are READ-ONLY against production data.
 */

export interface EdgeCaseQuestion {
  id: string;
  question: string;
  category: "missing_data" | "conflicting_data" | "merge_chain";
  description: string;
  expectedBehavior: "graceful" | "inform_user" | "suggest_correction";
  shouldNotMatch?: RegExp;
  shouldContain?: string[];
  difficulty: "easy" | "medium" | "hard";
}

// ============================================================================
// MISSING DATA SCENARIOS
// Tests how Tippy handles records with incomplete information
// ============================================================================

export const MISSING_DATA_SCENARIOS: EdgeCaseQuestion[] = [
  {
    id: "edge-person-no-email",
    question:
      "Find a person who has made a request but has no email address on file",
    category: "missing_data",
    description: "Tests handling of person records without email identifier",
    expectedBehavior: "graceful",
    shouldNotMatch: /error|failed|cannot|exception/i,
    difficulty: "easy",
  },
  {
    id: "edge-person-no-phone",
    question: "Find any person in the system who has no phone number recorded",
    category: "missing_data",
    description: "Tests handling of person records without phone identifier",
    expectedBehavior: "graceful",
    shouldNotMatch: /error|failed|cannot|exception/i,
    difficulty: "easy",
  },
  {
    id: "edge-cat-no-microchip",
    question: "Find cats in our system that don't have a microchip on record",
    category: "missing_data",
    description: "Tests handling of cat records without primary identifier",
    expectedBehavior: "graceful",
    shouldContain: ["cat", "microchip"],
    difficulty: "easy",
  },
  {
    id: "edge-place-no-geocode",
    question: "Are there any places in the system without geocode coordinates?",
    category: "missing_data",
    description: "Tests handling of place records without lat/lng",
    expectedBehavior: "inform_user",
    shouldNotMatch: /error|exception/i,
    difficulty: "medium",
  },
  {
    id: "edge-request-no-place",
    question: "Find requests that don't have a linked place or address",
    category: "missing_data",
    description: "Tests handling of orphaned request records",
    expectedBehavior: "graceful",
    shouldNotMatch: /error|failed|exception/i,
    difficulty: "medium",
  },
  {
    id: "edge-appointment-no-cat",
    question: "Are there any appointments that don't have a cat record linked?",
    category: "missing_data",
    description: "Tests handling of appointments with missing cat linkage",
    expectedBehavior: "graceful",
    difficulty: "medium",
  },
  {
    id: "edge-person-partial-name",
    question: "Find people who only have a first name or only a last name",
    category: "missing_data",
    description: "Tests handling of incomplete name data",
    expectedBehavior: "graceful",
    shouldNotMatch: /error|exception/i,
    difficulty: "easy",
  },
  {
    id: "edge-cat-no-breed",
    question: "How many cats don't have a breed recorded?",
    category: "missing_data",
    description: "Tests handling of cats without breed information",
    expectedBehavior: "graceful",
    shouldNotMatch: /error|exception/i,
    difficulty: "easy",
  },
];

// ============================================================================
// CONFLICTING DATA SCENARIOS
// Tests how Tippy handles records with different values across sources
// ============================================================================

export const CONFLICTING_DATA_SCENARIOS: EdgeCaseQuestion[] = [
  {
    id: "edge-conflicting-phone",
    question:
      "Are there people who have different phone numbers in ClinicHQ versus Airtable?",
    category: "conflicting_data",
    description: "Tests detection of phone number discrepancies across sources",
    expectedBehavior: "inform_user",
    shouldContain: ["phone", "different"],
    difficulty: "hard",
  },
  {
    id: "edge-conflicting-email",
    question:
      "Find people with different email addresses across different data sources",
    category: "conflicting_data",
    description: "Tests detection of email discrepancies",
    expectedBehavior: "inform_user",
    difficulty: "hard",
  },
  {
    id: "edge-conflicting-cat-name",
    question:
      "Are there cats that have different names in ShelterLuv vs ClinicHQ?",
    category: "conflicting_data",
    description: "Tests detection of cat name discrepancies across sources",
    expectedBehavior: "inform_user",
    difficulty: "hard",
  },
  {
    id: "edge-colony-estimate-diverge",
    question:
      "Find colonies where different sources give very different size estimates",
    category: "conflicting_data",
    description: "Tests handling of divergent colony estimates",
    expectedBehavior: "inform_user",
    shouldContain: ["estimate", "colony"],
    difficulty: "medium",
  },
  {
    id: "edge-conflicting-trapper-assignment",
    question:
      "Are there requests where the trapper in Airtable differs from the appointment trapper?",
    category: "conflicting_data",
    description: "Tests detection of trapper assignment discrepancies",
    expectedBehavior: "inform_user",
    difficulty: "hard",
  },
  {
    id: "edge-person-name-mismatch",
    question:
      "Find people where the name spelling differs between data sources",
    category: "conflicting_data",
    description: "Tests detection of name spelling variations",
    expectedBehavior: "inform_user",
    difficulty: "medium",
  },
];

// ============================================================================
// MERGE CHAIN SCENARIOS
// Tests how Tippy handles multi-hop merged entity relationships
// ============================================================================

export const MERGE_CHAIN_SCENARIOS: EdgeCaseQuestion[] = [
  {
    id: "edge-merge-person-chain",
    question:
      "Find a person record that has been merged multiple times (merge chain)",
    category: "merge_chain",
    description: "Tests navigation of multi-hop person merges",
    expectedBehavior: "graceful",
    shouldNotMatch: /error|exception/i,
    difficulty: "hard",
  },
  {
    id: "edge-merge-place-redirect",
    question:
      "What happens when you look up an address that was merged into another place?",
    category: "merge_chain",
    description: "Tests merged place redirect behavior",
    expectedBehavior: "graceful",
    difficulty: "medium",
  },
  {
    id: "edge-merge-cat-combined",
    question:
      "Trace a cat that was originally recorded as duplicates and later merged",
    category: "merge_chain",
    description: "Tests merged cat journey combination",
    expectedBehavior: "graceful",
    difficulty: "hard",
  },
  {
    id: "edge-merge-history-audit",
    question: "Show me the complete merge history for any merged person",
    category: "merge_chain",
    description: "Tests merge audit trail retrieval",
    expectedBehavior: "graceful",
    shouldContain: ["merge"],
    difficulty: "medium",
  },
  {
    id: "edge-orphan-after-merge",
    question:
      "Are there any orphaned records after entity merges (data that didn't transfer)?",
    category: "merge_chain",
    description: "Tests detection of orphaned data post-merge",
    expectedBehavior: "inform_user",
    difficulty: "hard",
  },
  {
    id: "edge-circular-merge",
    question: "Check if there are any circular merge references in the database",
    category: "merge_chain",
    description: "Tests detection of problematic circular merges",
    expectedBehavior: "inform_user",
    difficulty: "hard",
  },
];

// ============================================================================
// COMBINED EXPORTS
// ============================================================================

export const ALL_EDGE_CASE_QUESTIONS: EdgeCaseQuestion[] = [
  ...MISSING_DATA_SCENARIOS,
  ...CONFLICTING_DATA_SCENARIOS,
  ...MERGE_CHAIN_SCENARIOS,
];

export function getEdgeCasesByCategory(
  category: EdgeCaseQuestion["category"]
): EdgeCaseQuestion[] {
  return ALL_EDGE_CASE_QUESTIONS.filter((q) => q.category === category);
}

export function getEdgeCasesByDifficulty(
  difficulty: EdgeCaseQuestion["difficulty"]
): EdgeCaseQuestion[] {
  return ALL_EDGE_CASE_QUESTIONS.filter((q) => q.difficulty === difficulty);
}
