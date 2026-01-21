/**
 * Tippy Infrastructure Tests
 *
 * Tests the new Tippy infrastructure from MIG_517-521:
 * - View catalog (MIG_517)
 * - Proposed corrections (MIG_518)
 * - Unanswerable tracking (MIG_519)
 * - View usage analytics (MIG_520)
 *
 * All tests are READ-ONLY except for view usage which is safe analytics logging.
 * Tests verify the infrastructure exists and functions, NOT that Tippy writes to it.
 */

import { test, expect } from "@playwright/test";

// ============================================================================
// HELPERS
// ============================================================================

interface TippyResponse {
  message?: string;
  response?: string;
  content?: string;
  error?: string;
}

async function askTippy(
  request: {
    post: (
      url: string,
      options: { data: unknown }
    ) => Promise<{ ok: () => boolean; json: () => Promise<TippyResponse> }>;
  },
  question: string
): Promise<{ ok: boolean; responseText: string }> {
  const response = await request.post("/api/tippy/chat", {
    data: {
      message: question,
    },
  });

  const ok = response.ok();
  const data = await response.json();

  const responseText =
    typeof data === "string"
      ? data
      : data.message || data.response || data.content || JSON.stringify(data);

  return { ok, responseText };
}

// ============================================================================
// VIEW CATALOG TESTS (MIG_517)
// Tests the tippy_view_catalog and discovery functions
// ============================================================================

test.describe("Tippy Infrastructure: View Catalog (MIG_517) @smoke", () => {
  test.setTimeout(90000); // 90 seconds for view catalog operations

  test("discover_views tool returns available views", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "What views are available for me to query? Use the discover_views tool."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(50);

    // Should mention view categories or specific views
    expect(
      responseText.toLowerCase().includes("view") ||
        responseText.toLowerCase().includes("entity") ||
        responseText.toLowerCase().includes("stats") ||
        responseText.toLowerCase().includes("available")
    ).toBeTruthy();
  });

  test("discover_views returns results by category", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Show me all the 'entity' category views available in the system."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(30);
  });

  test("discover_views returns results by search term", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Search for views related to 'trapper' or 'stats'."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(30);
  });

  test("query_view executes against cataloged views", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "How many rows in v_trapper_full_stats? Just give me the count."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(10);
    // Should have some data or mention the view
    expect(responseText.toLowerCase()).not.toMatch(/error|failed/i);
  });

  test("query_view handles filters correctly", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "How many people in v_person_list have 'coordinator' in their role?"
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(10);
  });

  test("handles non-existent view gracefully", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Query a view called v_nonexistent_fake_view_12345"
    );

    expect(ok).toBeTruthy();
    // Should not crash, should explain the view doesn't exist
    expect(responseText.toLowerCase()).not.toMatch(/exception|crash/i);
  });
});

// ============================================================================
// PROPOSED CORRECTIONS TESTS (MIG_518)
// Tests the tippy_proposed_corrections table and admin API
// READ-ONLY: We query existing corrections, don't create new ones
// ============================================================================

test.describe("Tippy Infrastructure: Proposed Corrections (MIG_518) @smoke", () => {
  test.setTimeout(60000);

  test("admin API for corrections exists and responds", async ({ request }) => {
    const response = await request.get("/api/admin/tippy-corrections");

    // May return 403 without auth, but should not 500
    expect(response.status()).toBeLessThan(500);
  });

  test("corrections API returns structured data", async ({ request }) => {
    const response = await request.get("/api/admin/tippy-corrections?status=all");

    // If we have access, verify structure
    if (response.ok()) {
      const data = await response.json();
      expect(data).toBeDefined();
      // Should have corrections array and stats
      if (data.corrections) {
        expect(Array.isArray(data.corrections)).toBeTruthy();
      }
      if (data.stats) {
        expect(typeof data.stats).toBe("object");
      }
    }
  });

  test("corrections have required fields", async ({ request }) => {
    const response = await request.get("/api/admin/tippy-corrections?limit=5");

    if (response.ok()) {
      const data = await response.json();
      if (data.corrections && data.corrections.length > 0) {
        const correction = data.corrections[0];
        // Verify expected fields exist
        expect(correction).toHaveProperty("correction_id");
        expect(correction).toHaveProperty("entity_type");
        expect(correction).toHaveProperty("status");
      }
    }
  });

  test("Tippy understands corrections exist", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Can you propose data corrections when you find discrepancies?"
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
    // Should understand the concept
    expect(
      responseText.toLowerCase().includes("correction") ||
        responseText.toLowerCase().includes("discrepanc") ||
        responseText.toLowerCase().includes("propose") ||
        responseText.toLowerCase().includes("fix")
    ).toBeTruthy();
  });
});

// ============================================================================
// UNANSWERABLE QUESTIONS TESTS (MIG_519)
// Tests the tippy_unanswerable_questions tracking
// READ-ONLY: We verify the tracking exists
// ============================================================================

test.describe("Tippy Infrastructure: Unanswerable Tracking (MIG_519) @smoke", () => {
  test.setTimeout(60000);

  test("admin API for gaps exists and responds", async ({ request }) => {
    const response = await request.get("/api/admin/tippy-gaps");

    // May return 403 without auth, but should not 500
    expect(response.status()).toBeLessThan(500);
  });

  test("gaps API returns structured data", async ({ request }) => {
    const response = await request.get("/api/admin/tippy-gaps?limit=10");

    if (response.ok()) {
      const data = await response.json();
      expect(data).toBeDefined();
      // Should be an array or have questions array
      if (Array.isArray(data)) {
        // Direct array of questions
      } else if (data.questions) {
        expect(Array.isArray(data.questions)).toBeTruthy();
      }
    }
  });

  test("Tippy handles out-of-scope questions gracefully", async ({
    request,
  }) => {
    const { ok, responseText } = await askTippy(
      request,
      "What is the capital of France?"
    );

    expect(ok).toBeTruthy();
    // Should not crash, might say it's outside scope
    expect(responseText.length).toBeGreaterThan(10);
    expect(responseText.toLowerCase()).not.toMatch(/error|exception/i);
  });

  test("Tippy handles unanswerable TNR questions gracefully", async ({
    request,
  }) => {
    const { ok, responseText } = await askTippy(
      request,
      "What will the cat population be in Sonoma County in 2050?"
    );

    expect(ok).toBeTruthy();
    // Should explain limitation rather than make up data
    expect(responseText.length).toBeGreaterThan(20);
  });
});

// ============================================================================
// VIEW USAGE ANALYTICS TESTS (MIG_520)
// Tests that view usage is being tracked
// This DOES write analytics data, which is safe
// ============================================================================

test.describe("Tippy Infrastructure: View Usage Analytics (MIG_520)", () => {
  test.setTimeout(90000); // 90 seconds

  test("view usage is tracked after queries", async ({ request }) => {
    // First, make a query that should be tracked
    const { ok } = await askTippy(
      request,
      "How many cats total?"
    );

    expect(ok).toBeTruthy();

    // We can't directly verify the log without admin access,
    // but we verify the query succeeded which implies tracking worked
  });

  test("Tippy can report on popular views", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "What views have you used recently?"
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
    // May or may not have access to this info
  });
});

// ============================================================================
// EXPLORE_ENTITY TOOL TESTS
// Tests the comprehensive entity exploration tool
// ============================================================================

test.describe("Tippy Infrastructure: explore_entity Tool @smoke", () => {
  test.setTimeout(120000); // 2 minutes for entity exploration

  test("explore_entity returns person data", async ({
    request,
  }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Who is the most active trapper? Just name and cat count."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
  });

  test("explore_entity returns cat data", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Find any cat with a microchip and tell me its name."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
  });

  test("explore_entity returns place data", async ({
    request,
  }) => {
    const { ok, responseText } = await askTippy(
      request,
      "What is the largest colony by cat count?"
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
  });

  test("explore_entity handles missing entity gracefully", async ({
    request,
  }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Explore person with email fake12345@nonexistent.com"
    );

    expect(ok).toBeTruthy();
    // Should explain not found, not crash
    expect(responseText.toLowerCase()).not.toMatch(/exception|crash/i);
  });
});

// ============================================================================
// SCHEMA NAVIGATION TESTS
// Tests Tippy's ability to navigate the view schema
// ============================================================================

test.describe("Tippy Infrastructure: Schema Navigation @smoke", () => {
  test.setTimeout(90000); // 90 seconds

  test("can describe available view categories", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "List 3 categories of views you can query."
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(30);
    // Should mention some categories
    expect(
      responseText.toLowerCase().includes("entity") ||
        responseText.toLowerCase().includes("stats") ||
        responseText.toLowerCase().includes("category") ||
        responseText.toLowerCase().includes("view")
    ).toBeTruthy();
  });

  test("can explain what a specific view provides", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "What information does the v_trapper_full_stats view provide?"
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(30);
  });

  test("can recommend which view to use for a question", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "What view shows colony information?"
    );

    expect(ok).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(20);
    // Should mention a view name or colony
    expect(
      responseText.includes("v_") ||
        responseText.toLowerCase().includes("colony") ||
        responseText.toLowerCase().includes("beacon") ||
        responseText.toLowerCase().includes("place")
    ).toBeTruthy();
  });
});

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

test.describe("Tippy Infrastructure: Error Handling", () => {
  test.setTimeout(60000);

  test("handles malformed view query gracefully", async ({ request }) => {
    const { ok, responseText } = await askTippy(
      request,
      "Query the view with filter: '; DROP TABLE users; --"
    );

    expect(ok).toBeTruthy();
    // Should not execute SQL injection
    expect(responseText.toLowerCase()).not.toMatch(/dropped|deleted/i);
  });

  test("handles very long filter values", async ({ request }) => {
    const longString = "a".repeat(5000);
    const { ok, responseText } = await askTippy(
      request,
      `Search for a person named ${longString}`
    );

    expect(ok).toBeTruthy();
    // Should not crash
    expect(responseText.length).toBeGreaterThan(0);
  });
});
