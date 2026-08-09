import { expect, Page, test } from '@playwright/test';

async function openTraining(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder('Alex Stone').fill('Camp Tester');
  await page.getByPlaceholder('Harbour City').fill('Camp United');
  await page.getByPlaceholder('HBC').fill('CPU');
  await page.locator('button').filter({ hasText: /start|karriere|begin/i }).first().click();
  await page.goto('/training');
  await expect(page.locator('.training-workspace')).toBeVisible();
}

test('weekly plan can be drafted and executed as one operation', async ({ page }) => {
  await openTraining(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.program-action button').click();
  await expect(page.locator('.session-card').filter({ hasText: /abschluss|finishing/i })).toBeVisible();
  await page.locator('.target-player:not([disabled])').first().click();
  const execute = page.locator('.execute-button');
  await expect(execute).toBeEnabled();
  await execute.click();
  await expect(page.locator('.training-feedback')).toContainText(/erfolgreich|successfully/i);
  await expect(page.locator('.session-card.completed')).toHaveCount(1);
});

test('training panels stay viewport-bound and switch cleanly on mobile', async ({ page }) => {
  await openTraining(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth > innerWidth,
      vertical: document.documentElement.scrollHeight > innerHeight,
      contentBottom: Math.round(document.querySelector('main.content')!.getBoundingClientRect().bottom),
    }))).toEqual({ horizontal: false, vertical: false, contentBottom: viewport.height });
  }
  await page.locator('.training-mobile-tabs button').filter({ hasText: /programme|programs/i }).click();
  await expect(page.locator('.program-library')).toBeVisible();
  await expect(page.locator('.week-schedule')).toBeHidden();
  await page.locator('.training-mobile-tabs button').filter({ hasText: /wochenplan|schedule/i }).click();
  await expect(page.locator('.week-schedule')).toBeVisible();
  await expect(page.locator('.mobile-execute')).toBeInViewport();
});
