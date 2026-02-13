
import { test, expect } from '@playwright/test';

test('ZK Auth Flow: Navigate -> Prove -> Verify', async ({ page }) => {
    console.log('Navigating to /labs/the-farm...');
    // 1. Navigate to The Farm
    await page.goto('/labs/the-farm');

    // Verify initial load
    const title = page.locator('h1');
    await expect(title).toContainText('THE FARM', { timeout: 10000 });
    console.log('Page loaded.');

    // 2. Set Balance via Hook
    console.log('Waiting for window.__setBalance hook...');
    // Force retry a few times
    let hooked = false;
    for (let i = 0; i < 20; i++) {
        const exists = await page.evaluate(() => typeof (window as any).__setBalance === 'function');
        if (exists) {
            hooked = true;
            break;
        }
        await page.waitForTimeout(500);
    }

    if (!hooked) {
        throw new Error('Test hook __setBalance missing.');
    }

    await page.evaluate(() => {
        // @ts-ignore
        window.__setBalance(5000000000n); // 500 * 10^7
    });
    console.log('Balance set.');

    // 3. Select Noir System
    console.log('Selecting Noir system...');
    await page.getByRole('tab', { name: 'Noir (UltraHonk)' }).click();

    // 4. Verify UI Updates
    const btn = page.locator('button.verify');
    await expect(btn).toBeEnabled();

    // 5. Click Generate Proof
    console.log('Clicking Verify locally...');
    await btn.click();

    // 5. Verify Progress States
    await expect(btn).toContainText('Verifying...');

    // 6. Verify Success
    try {
        await expect(page.locator('p.ok')).toContainText('Verified locally', { timeout: 60000 });
    } catch (e) {
        const err = page.locator('p.bad');
        if (await err.isVisible()) {
            console.error("Proof failed with error:", await err.textContent());
            throw new Error(`Proof Generation Failed: ${await err.textContent()}`);
        }
        throw e;
    }

});
