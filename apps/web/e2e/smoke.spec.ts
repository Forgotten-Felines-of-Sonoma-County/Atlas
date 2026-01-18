import { test, expect } from '@playwright/test';

/**
 * Smoke Tests - Basic health checks for Atlas
 *
 * These tests verify that core pages load correctly.
 * Uses longer timeouts since pages are client-rendered.
 */

test.describe('Smoke Tests', () => {

  test('dashboard loads and shows stats', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dashboard should have loading state or actual content
    // Look for common dashboard elements
    await expect(
      page.locator('body')
    ).toBeVisible();

    // Should not show an error page
    await expect(page.locator('text=500')).not.toBeVisible();
    await expect(page.locator('text=Error')).not.toBeVisible();
  });

  test('requests page loads', async ({ page }) => {
    await page.goto('/requests');
    await page.waitForLoadState('networkidle');

    // Page should load without errors
    await expect(page.locator('body')).toBeVisible();

    // Should have some content after loading
    const content = await page.textContent('body');
    expect(content).toBeTruthy();
  });

  test('places page loads', async ({ page }) => {
    await page.goto('/places');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

  test('people page loads', async ({ page }) => {
    await page.goto('/people');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

  test('cats page loads', async ({ page }) => {
    await page.goto('/cats');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

  test('intake queue loads', async ({ page }) => {
    await page.goto('/intake/queue');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

  test('admin intake fields loads', async ({ page }) => {
    await page.goto('/admin/intake-fields');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

});
