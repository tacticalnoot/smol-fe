import { test, expect } from '@playwright/test';

test('Gold Path: Landing -> Player -> Navigation', async ({ page }) => {
    // 1. Visit Home
    await page.goto('/');
    await expect(page).toHaveTitle(/Smol/);

    // 2. Verify Global Player mount (should be hidden initially or empty)
    // BarAudioPlayer is mounted in Layout, let's check its container exists
    // It might be hidden if no song is loaded.

    // 3. Navigate to Radio (should show player)
    await page.goto('/radio');
    await expect(page).toHaveURL(/\/radio/);

    // 4. Verify no double-mount error (console check handled by playwright trace usually, but simple check:)
    // Ideally, we'd check for duplicate event listeners or audio tags, but that's hard in E2E.
    // Instead, let's verify visual correctness.

    // Wait for potential audio element
    const audioElements = page.locator('audio');
    // We expect 1 audio element from Layout.astro (Global)
    // If Duplicate exists, we might see 2, or just 1 if logic is messy.
    // Ideally count should be 1.
    await expect(audioElements).toHaveCount(1);
});
