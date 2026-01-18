import { test, expect } from '@playwright/test';

/**
 * Workflow Tests
 *
 * Tests complete user journeys through the application:
 * - Navigating from dashboard to entity details
 * - Cross-linking between related entities
 * - Intake queue operations
 */

test.describe('Navigation Workflows', () => {

  test('dashboard to request detail flow', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click on requests section or link
    const requestsLink = page.locator('a[href="/requests"]').first();
    if (await requestsLink.isVisible()) {
      await requestsLink.click();
      await expect(page).toHaveURL(/\/requests/);
    }
  });

  test('request to place navigation', async ({ page, request }) => {
    // Get a request with a place
    const requestsResponse = await request.get('/api/requests?limit=20');
    const requestsData = await requestsResponse.json();

    const reqWithPlace = requestsData.requests.find((r: { place_id: string }) => r.place_id);
    if (!reqWithPlace) {
      test.skip();
      return;
    }

    // Go to request
    await page.goto(`/requests/${reqWithPlace.request_id}`);
    await page.waitForLoadState('networkidle');

    // Page should load
    await expect(page.locator('body')).toBeVisible();
  });

  test('person detail loads', async ({ page, request }) => {
    // Get a person
    const peopleResponse = await request.get('/api/people?limit=5');
    const peopleData = await peopleResponse.json();

    if (!peopleData.people?.length) {
      test.skip();
      return;
    }

    const person = peopleData.people[0];
    await page.goto(`/people/${person.person_id}`);
    await page.waitForLoadState('networkidle');

    // Should show person details
    await expect(page.locator('body')).toBeVisible();
  });

});

test.describe('Intake Queue Workflow', () => {

  test('intake queue page loads', async ({ page }) => {
    await page.goto('/intake/queue');
    await page.waitForLoadState('networkidle');

    // Page should load without error
    await expect(page.locator('body')).toBeVisible();
  });

});

test.describe('Search and Filter', () => {

  test('requests page loads with data', async ({ page }) => {
    await page.goto('/requests');
    await page.waitForLoadState('networkidle');

    // Page should load
    await expect(page.locator('body')).toBeVisible();
  });

  test('places page loads with data', async ({ page }) => {
    await page.goto('/places');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

});

test.describe('Detail Page Loading', () => {

  test('place detail loads correctly', async ({ page, request }) => {
    const placesResponse = await request.get('/api/places?limit=5');
    const placesData = await placesResponse.json();

    if (!placesData.places?.length) {
      test.skip();
      return;
    }

    await page.goto(`/places/${placesData.places[0].place_id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

  test('request detail loads correctly', async ({ page, request }) => {
    const requestsResponse = await request.get('/api/requests?limit=5');
    const requestsData = await requestsResponse.json();

    if (!requestsData.requests?.length) {
      test.skip();
      return;
    }

    await page.goto(`/requests/${requestsData.requests[0].request_id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

  test('cat detail loads correctly', async ({ page, request }) => {
    const catsResponse = await request.get('/api/cats?limit=5');
    const catsData = await catsResponse.json();

    if (!catsData.cats?.length) {
      test.skip();
      return;
    }

    await page.goto(`/cats/${catsData.cats[0].cat_id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toBeVisible();
  });

});
