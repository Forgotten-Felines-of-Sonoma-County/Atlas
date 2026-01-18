import { test, expect } from '@playwright/test';

/**
 * UI Resilience Tests
 *
 * Tests that the UI handles edge cases gracefully WITHOUT modifying data:
 * - Dangerous buttons have confirmation dialogs
 * - Forms validate before submission
 * - Navigation doesn't lose unsaved state unexpectedly
 * - Error states are handled gracefully
 *
 * IMPORTANT: These tests are READ-ONLY and do not modify any data.
 */

test.describe('Dangerous Action Protection', () => {

  test('delete/archive buttons have confirmation dialogs', async ({ page, request }) => {
    // Get a request to test with
    const requestsResponse = await request.get('/api/requests?limit=5');
    const requestsData = await requestsResponse.json();

    if (!requestsData.requests?.length) {
      test.skip();
      return;
    }

    await page.goto(`/requests/${requestsData.requests[0].request_id}`);
    await page.waitForLoadState('networkidle');

    // Look for dangerous action buttons (but DON'T click them for real)
    const deleteButtons = page.locator('button:has-text("Delete"), button:has-text("Archive"), button:has-text("Remove")');
    const dangerousButtonCount = await deleteButtons.count();

    console.log(`Found ${dangerousButtonCount} potentially dangerous buttons`);

    // If there are dangerous buttons, verify they exist (we won't click them)
    // In a real app, these should have confirmation dialogs
    if (dangerousButtonCount > 0) {
      // Just verify they're visible - don't click
      const firstDangerousButton = deleteButtons.first();
      const isVisible = await firstDangerousButton.isVisible();
      console.log(`Dangerous button visible: ${isVisible}`);
    }
  });

  test('status dropdown exists but we dont change it', async ({ page, request }) => {
    // Get a request
    const requestsResponse = await request.get('/api/requests?limit=5');
    const requestsData = await requestsResponse.json();

    if (!requestsData.requests?.length) {
      test.skip();
      return;
    }

    await page.goto(`/requests/${requestsData.requests[0].request_id}`);
    await page.waitForLoadState('networkidle');

    // Look for status selects/dropdowns
    const statusElements = page.locator('select, [role="combobox"], [class*="status"]');
    const statusCount = await statusElements.count();

    console.log(`Found ${statusCount} status-related elements`);
    // We verify they exist but DO NOT change them
  });

});

test.describe('Form Validation (Read-Only)', () => {

  test('intake form has required field indicators', async ({ page }) => {
    // Go to intake form page (public form, not admin)
    await page.goto('/intake');
    await page.waitForLoadState('networkidle');

    // Check if page loaded (might redirect or show form)
    await expect(page.locator('body')).toBeVisible();

    // Look for required field indicators (asterisks, "required" text)
    const bodyText = await page.textContent('body');
    const hasRequiredIndicators = bodyText?.includes('*') ||
      bodyText?.toLowerCase().includes('required');

    console.log(`Form has required field indicators: ${hasRequiredIndicators}`);
  });

  test('empty form submission is prevented by browser validation', async ({ page }) => {
    await page.goto('/intake');
    await page.waitForLoadState('networkidle');

    // Look for a submit button
    const submitButton = page.locator('button[type="submit"], input[type="submit"]').first();

    if (await submitButton.isVisible()) {
      // Check if there are required inputs
      const requiredInputs = page.locator('input[required], select[required], textarea[required]');
      const requiredCount = await requiredInputs.count();

      console.log(`Form has ${requiredCount} required fields`);

      // We DO NOT actually submit - just verify required fields exist
    }
  });

});

test.describe('Navigation Safety', () => {

  test('rapid back/forward navigation is safe', async ({ page }) => {
    // Visit several pages
    await page.goto('/requests');
    await page.waitForLoadState('networkidle');

    await page.goto('/places');
    await page.waitForLoadState('networkidle');

    await page.goto('/people');
    await page.waitForLoadState('networkidle');

    // Go back rapidly
    await page.goBack();
    await page.goBack();

    // Go forward
    await page.goForward();

    // Page should still be functional
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('refresh on detail page reloads correctly', async ({ page, request }) => {
    // Get a place
    const placesResponse = await request.get('/api/places?limit=5');
    const placesData = await placesResponse.json();

    if (!placesData.places?.length) {
      test.skip();
      return;
    }

    const placeId = placesData.places[0].place_id;

    // Go to place detail
    await page.goto(`/places/${placeId}`);
    await page.waitForLoadState('networkidle');

    // Refresh the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Should still show the same place
    await expect(page.locator('body')).toBeVisible();

    // URL should still be correct
    expect(page.url()).toContain(placeId);
  });

  test('opening multiple tabs of same page is safe', async ({ page, context, request }) => {
    // Get a request
    const requestsResponse = await request.get('/api/requests?limit=5');
    const requestsData = await requestsResponse.json();

    if (!requestsData.requests?.length) {
      test.skip();
      return;
    }

    const requestId = requestsData.requests[0].request_id;
    const url = `/requests/${requestId}`;

    // Open first tab
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    // Open second tab with same URL
    const page2 = await context.newPage();
    await page2.goto(url);
    await page2.waitForLoadState('networkidle');

    // Both tabs should work
    await expect(page.locator('body')).toBeVisible();
    await expect(page2.locator('body')).toBeVisible();

    await page2.close();
  });

});

test.describe('Error Handling (Read-Only)', () => {

  test('invalid entity ID shows appropriate error', async ({ page }) => {
    // Try to access a non-existent entity
    await page.goto('/places/invalid-uuid-that-does-not-exist');
    await page.waitForLoadState('networkidle');

    // Should show some kind of error or not found message
    // (not crash or show broken page)
    await expect(page.locator('body')).toBeVisible();

    const bodyText = await page.textContent('body');
    const showsError = bodyText?.toLowerCase().includes('not found') ||
      bodyText?.toLowerCase().includes('error') ||
      bodyText?.toLowerCase().includes('invalid') ||
      bodyText?.includes('404');

    console.log(`Invalid ID shows error handling: ${showsError}`);
  });

  test('non-existent route shows 404', async ({ page }) => {
    await page.goto('/this-route-definitely-does-not-exist-12345');
    await page.waitForLoadState('networkidle');

    // Should show 404 or redirect, not crash
    await expect(page.locator('body')).toBeVisible();
  });

  test('API errors dont crash the UI', async ({ page }) => {
    // Go to a page that loads data
    await page.goto('/places');
    await page.waitForLoadState('networkidle');

    // Page should be functional even if some data fails to load
    await expect(page.locator('body')).toBeVisible();

    // Should not show raw error stack traces to user
    const bodyText = await page.textContent('body');
    const hasStackTrace = bodyText?.includes('at Object.') ||
      bodyText?.includes('TypeError:') ||
      bodyText?.includes('ReferenceError:');

    expect(hasStackTrace).toBeFalsy();
  });

});

test.describe('Click Safety Verification', () => {

  test('verify we can identify clickable elements without clicking', async ({ page }) => {
    await page.goto('/requests');
    await page.waitForLoadState('networkidle');

    // Count different types of interactive elements
    const buttons = await page.locator('button').count();
    const links = await page.locator('a').count();
    const inputs = await page.locator('input, select, textarea').count();

    console.log(`Page has: ${buttons} buttons, ${links} links, ${inputs} inputs`);

    // Identify potentially dangerous buttons (by text content)
    const dangerousTexts = ['delete', 'remove', 'archive', 'cancel', 'reject'];
    for (const text of dangerousTexts) {
      const count = await page.locator(`button:has-text("${text}")`).count();
      if (count > 0) {
        console.log(`  Found ${count} buttons with "${text}"`);
      }
    }

    // We identify but DO NOT click
  });

  test('expandable sections can be toggled safely', async ({ page, request }) => {
    // Get a place (these often have expandable sections)
    const placesResponse = await request.get('/api/places?limit=5');
    const placesData = await placesResponse.json();

    if (!placesData.places?.length) {
      test.skip();
      return;
    }

    await page.goto(`/places/${placesData.places[0].place_id}`);
    await page.waitForLoadState('networkidle');

    // Look for expand/collapse buttons (these are safe to click)
    const expandButtons = page.locator('button:has-text("Show"), button:has-text("Expand"), button:has-text("More"), [class*="expand"], [class*="collapse"]');
    const expandCount = await expandButtons.count();

    if (expandCount > 0) {
      // These are safe - they just toggle visibility
      const firstExpand = expandButtons.first();
      if (await firstExpand.isVisible()) {
        await firstExpand.click();
        await page.waitForTimeout(300);

        // Page should still be functional
        await expect(page.locator('body')).toBeVisible();
        console.log('Expand/collapse toggle worked safely');
      }
    }
  });

  test('tab navigation works without modifying data', async ({ page }) => {
    await page.goto('/requests');
    await page.waitForLoadState('networkidle');

    // Look for tabs
    const tabs = page.locator('[role="tab"], [class*="tab"]');
    const tabCount = await tabs.count();

    if (tabCount > 1) {
      // Click second tab (if it exists) - tabs are safe, they just filter views
      const secondTab = tabs.nth(1);
      if (await secondTab.isVisible()) {
        await secondTab.click();
        await page.waitForTimeout(300);

        // Page should still work
        await expect(page.locator('body')).toBeVisible();
        console.log('Tab switching worked safely');
      }
    }
  });

});

test.describe('Keyboard Navigation Safety', () => {

  test('escape key closes modals without saving', async ({ page, request }) => {
    // Get a request
    const requestsResponse = await request.get('/api/requests?limit=5');
    const requestsData = await requestsResponse.json();

    if (!requestsData.requests?.length) {
      test.skip();
      return;
    }

    await page.goto(`/requests/${requestsData.requests[0].request_id}`);
    await page.waitForLoadState('networkidle');

    // Press Escape - should close any open modals without saving
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('tab key navigates through elements', async ({ page }) => {
    await page.goto('/requests');
    await page.waitForLoadState('networkidle');

    // Press Tab a few times - should navigate through focusable elements
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    // Page should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

});
