import { expect, test } from '@playwright/test';

const sampleSongId = '491bb94b-79df-41bb-b09b-2d295f1dfd05';

test('home navigation reaches radio builder', async ({ page }) => {
  await page.goto('/');

  const radioLink = page.getByRole('link', { name: 'Radio' });
  await expect(radioLink).toBeVisible();
  await radioLink.click();

  await expect(page).toHaveURL(/\/radio/);
  await expect(page.getByRole('heading', { name: /SMOL/i })).toBeVisible();
  await expect(page.getByText(/RADIO/i)).toBeVisible();
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
