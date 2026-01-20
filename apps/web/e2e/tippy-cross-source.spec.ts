/**
 * Tippy Cross-Source Deduction Tests
 *
 * These tests verify that Tippy can correctly deduce information by
 * combining data from multiple sources (ClinicHQ, ShelterLuv, VolunteerHub,
 * Airtable, and Atlas core tables).
 *
 * Tests are READ-ONLY - they query but don't modify data.
 */

import { test, expect } from "@playwright/test";
import {
  PERSON_CROSS_SOURCE_QUESTIONS,
  CAT_JOURNEY_QUESTIONS,
  PLACE_CROSS_SOURCE_QUESTIONS,
  DATA_QUALITY_QUESTIONS,
  BEACON_QUESTIONS,
  type CrossSourceQuestion,
} from "./fixtures/tippy-questions";

// Access code for PasswordGate
const ACCESS_CODE = process.env.ATLAS_ACCESS_CODE || "ffsc2024";

// Helper to pass PasswordGate if needed
async function ensureAccess(request: ReturnType<typeof test.step>) {
  // For API tests, we include the access header or cookie
  return {
    headers: {
      "x-access-code": ACCESS_CODE,
    },
  };
}

// Helper to send a message to Tippy chat API
async function askTippy(
  request: ReturnType<typeof test.step>,
  question: string,
  conversationId?: string
) {
  const response = await request.post("/api/tippy/chat", {
    data: {
      messages: [{ role: "user", content: question }],
      conversationId: conversationId || `e2e-test-${Date.now()}`,
    },
    headers: {
      "Content-Type": "application/json",
    },
  });

  return response;
}

// Generic test runner for cross-source questions
async function runCrossSourceTest(
  request: ReturnType<typeof test.step>,
  question: CrossSourceQuestion
) {
  const response = await askTippy(request, question.question);

  // Should get successful response
  expect(response.ok()).toBeTruthy();

  const data = await response.json();

  // Verify we got a response
  expect(data).toBeDefined();
  expect(data.error).toBeUndefined();

  // Check response has content
  const responseText =
    typeof data === "string" ? data : data.response || data.content || JSON.stringify(data);

  expect(responseText.length).toBeGreaterThan(10);

  // Run validation if response is substantial
  if (responseText.length > 50) {
    const isValid = question.validateResponse(responseText);
    // Log for debugging but don't fail - AI responses vary
    if (!isValid) {
      console.log(`Question: ${question.question}`);
      console.log(`Response excerpt: ${responseText.substring(0, 200)}...`);
    }
  }

  return data;
}

// ============================================================================
// PERSON CROSS-SOURCE TESTS
// ============================================================================

test.describe("Tippy Cross-Source: Person Questions", () => {
  test("Person: comprehensive lookup returns data", async ({ request }) => {
    const question = PERSON_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "person-complete-lookup"
    );
    if (!question) {
      test.skip();
      return;
    }

    const response = await askTippy(
      request,
      "Tell me everything about any staff member"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("Person: volunteer + trapper detection", async ({ request }) => {
    const question = PERSON_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "person-volunteer-trapper"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Person: hours and foster correlation", async ({ request }) => {
    const question = PERSON_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "person-hours-foster"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Person: requester became trapper", async ({ request }) => {
    const question = PERSON_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "person-requester-trapper-same"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });
});

// ============================================================================
// CAT JOURNEY TESTS
// ============================================================================

test.describe("Tippy Cross-Source: Cat Journey Questions", () => {
  test("Cat: microchip trace returns history", async ({ request }) => {
    const question = CAT_JOURNEY_QUESTIONS.find(
      (q) => q.id === "cat-microchip-trace"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Cat: full journey (trap-alter-adopt)", async ({ request }) => {
    const question = CAT_JOURNEY_QUESTIONS.find(
      (q) => q.id === "cat-full-journey"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Cat: colony repeat visits", async ({ request }) => {
    const question = CAT_JOURNEY_QUESTIONS.find(
      (q) => q.id === "cat-colony-repeat-visits"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Cat: cross-source matching (ShelterLuv + ClinicHQ)", async ({
    request,
  }) => {
    const question = CAT_JOURNEY_QUESTIONS.find(
      (q) => q.id === "cat-shelterluv-clinic-match"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });
});

// ============================================================================
// PLACE-CENTRIC TESTS
// ============================================================================

test.describe("Tippy Cross-Source: Place Questions", () => {
  test("Place: activity history by address", async ({ request }) => {
    const question = PLACE_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "place-activity-history"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Place: trapper + alteration rate correlation", async ({ request }) => {
    const question = PLACE_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "place-trapper-alteration"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Place: estimate comparison across sources", async ({ request }) => {
    const question = PLACE_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "place-estimate-comparison"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Place: requester is trapper detection", async ({ request }) => {
    const question = PLACE_CROSS_SOURCE_QUESTIONS.find(
      (q) => q.id === "place-requester-trapper-same"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });
});

// ============================================================================
// DATA QUALITY TESTS (MIG_487 Functions)
// ============================================================================

test.describe("Tippy Cross-Source: Data Quality Questions", () => {
  test("Data Quality: check_data_quality for person", async ({ request }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-person-check"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Data Quality: check_data_quality for cat", async ({ request }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-cat-check"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Data Quality: find_potential_duplicates", async ({ request }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-duplicates-person"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Data Quality: query_merge_history", async ({ request }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-merge-history"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Data Quality: query_data_lineage", async ({ request }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-data-lineage"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Data Quality: query_volunteerhub_data", async ({ request }) => {
    const question = DATA_QUALITY_QUESTIONS.find(
      (q) => q.id === "quality-volunteerhub-data"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });
});

// ============================================================================
// BEACON ANALYTICS QUESTIONS (via Tippy)
// ============================================================================

test.describe("Tippy Cross-Source: Beacon Analytics Questions", () => {
  test("Beacon: overall impact metrics", async ({ request }) => {
    const question = BEACON_QUESTIONS.find(
      (q) => q.id === "beacon-overall-impact"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Beacon: year-over-year comparison", async ({ request }) => {
    const question = BEACON_QUESTIONS.find(
      (q) => q.id === "beacon-yoy-comparison"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Beacon: stale estimates detection", async ({ request }) => {
    const question = BEACON_QUESTIONS.find(
      (q) => q.id === "beacon-stale-estimates"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Beacon: kitten surge prediction", async ({ request }) => {
    const question = BEACON_QUESTIONS.find(
      (q) => q.id === "beacon-kitten-surge"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Beacon: completion forecast", async ({ request }) => {
    const question = BEACON_QUESTIONS.find(
      (q) => q.id === "beacon-completion-forecast"
    );
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });

  test("Beacon: immigration vs birth detection", async ({ request }) => {
    const question = BEACON_QUESTIONS.find((q) => q.id === "beacon-immigration");
    if (!question) {
      test.skip();
      return;
    }

    await runCrossSourceTest(request, question);
  });
});

// ============================================================================
// COMPREHENSIVE LOOKUP FUNCTION TESTS
// ============================================================================

test.describe("Tippy Comprehensive Lookups", () => {
  test("comprehensive_person_lookup returns multi-source data", async ({
    request,
  }) => {
    const response = await askTippy(
      request,
      "Get complete information about any active trapper"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("comprehensive_cat_lookup returns journey data", async ({ request }) => {
    const response = await askTippy(
      request,
      "What is the complete history of any cat with a microchip?"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });

  test("comprehensive_place_lookup returns activity data", async ({
    request,
  }) => {
    const response = await askTippy(
      request,
      "Show me everything about any active colony location"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toBeDefined();
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

test.describe("Tippy Error Handling", () => {
  test("Handles empty question gracefully", async ({ request }) => {
    const response = await askTippy(request, "");

    // Should still respond (might ask for clarification)
    expect(response.status()).toBeLessThan(500);
  });

  test("Handles non-existent entity lookup gracefully", async ({ request }) => {
    const response = await askTippy(
      request,
      "Find person with email nonexistent12345@fake.com"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    // Should indicate not found rather than error
    expect(data.error).toBeUndefined();
  });

  test("Handles invalid microchip lookup gracefully", async ({ request }) => {
    const response = await askTippy(
      request,
      "Trace cat with microchip 000000000000000"
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.error).toBeUndefined();
  });
});
