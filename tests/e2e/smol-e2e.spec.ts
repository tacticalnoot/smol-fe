import { expect, test } from '@playwright/test';

const sampleSongId = 'a96760878f1cc19af6e190bed5c45fe55d4ea16d3c9f3d61db440a61e1ff4d87';

test.beforeEach(async ({ page }) => {
  // Avoid global onboarding redirects during navigation smoke tests.
  await page.addInitScript(() => {
    localStorage.setItem('smol_onboarding_complete', 'true');
  });
});

test('home navigation reaches radio builder', async ({ page }) => {
  // Block external API calls to force snapshot fallback and speed up test
  await page.route('**/api.smol.xyz/**', route => route.abort());

  await page.goto('/');

  const radioLink = page.getByRole('link', { name: 'Radio' });
  await expect(radioLink).toBeVisible();
  await radioLink.click({ force: true });

  await expect(page).toHaveURL(/\/radio/);
  await expect(page).toHaveURL(/\/radio/);
  await expect(page.getByRole('heading', { name: /SMOLRADIO/i })).toBeVisible();

  // Verify Audio Logic Fix: Only ONE audio element should exist (Global Player)
  // If duplicate existed (one in Layout, one in RadioPlayer), this would be > 1
  await expect(page.locator('audio')).toHaveCount(1);
});

test('song page includes MusicRecording schema with datePublished', async ({ page }) => {
  await page.goto(`/${sampleSongId}`);
  await page.waitForLoadState('domcontentloaded');

  const rawBlocks = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();

  const blocks = rawBlocks.flatMap((content) => {
    try {
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      return [] as Record<string, unknown>[];
    }
  });

  const recording = blocks.find(
    (block) => block['@type'] === 'MusicRecording',
  ) as { datePublished?: string } | undefined;

  expect(recording?.datePublished).toBeTruthy();
});

test('labs index includes restored pages and their routes load', async ({ page }) => {
  await page.goto('/labs', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('a[href="/labs/lastframe"]')).toBeVisible();
  await expect(page.locator('a[href="/labs/the-farm"]')).toBeVisible();
  await expect(page.locator('a[href="/labs/the-vip"]')).toBeVisible();

  await page.goto('/labs/lastframe', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').filter({ hasText: /LASTFRAME/i })).toBeVisible();

  await page.goto('/labs/the-farm', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: '← Labs' })).toBeVisible();

  await page.goto('/labs/the-vip', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').filter({ hasText: /THE VIP/i })).toBeVisible();
});

test('zkdungeon legacy routes redirect to /labs/the-farm/zkdungeon', async ({ page }) => {
  await page.goto('/zkdungeon', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/labs\/the-farm\/zkdungeon/);
  await expect(page.locator('.dungeon-game-wrapper')).toBeVisible();

  await page.goto('/labs/the-farm/dungeon-room', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/labs\/the-farm\/zkdungeon/);
});
