import { expect, Page, test } from '@playwright/test';

async function createCareer(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder('Alex Stone').fill('Tactical Tester');
  await page.getByPlaceholder('Harbour City').fill('Tactic Town');
  await page.getByPlaceholder('HBC').fill('TCT');
  const start = page.locator('button').filter({ hasText: /start|karriere|begin/i }).first();
  await start.click();
  await page.goto('/tactics');
  await expect(page.locator('.tactic-pitch')).toBeVisible();
}

test('tactics workspace stays inside the app viewport and keeps its controls reachable', async ({ page }) => {
  await createCareer(page);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth > innerWidth,
      vertical: document.documentElement.scrollHeight > innerHeight,
      contentBottom: Math.round(document.querySelector('main.content')!.getBoundingClientRect().bottom),
      viewportBottom: innerHeight,
    }))).toEqual({ horizontal: false, vertical: false, contentBottom: viewport.height, viewportBottom: viewport.height });
    await expect(page.locator('.command-head')).toBeInViewport();
  }
});

test('presets, lineup swap and keyboard shape editing are interactive', async ({ page }) => {
  await createCareer(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const gamePlan = page.locator('.inspector-tabs button').filter({ hasText: /spielidee|game plan/i });
  await gamePlan.click();
  const counter = page.locator('.preset-grid button').filter({ hasText: /konter|counter/i });
  await counter.click();
  await expect(counter).toHaveClass(/active/);

  const slots = page.locator('.formation-slot');
  const firstName = await slots.nth(1).locator('.slot-copy b').textContent();
  const secondName = await slots.nth(2).locator('.slot-copy b').textContent();
  await slots.nth(1).dragTo(slots.nth(2));
  await expect(slots.nth(1).locator('.slot-copy b')).toHaveText(secondName!);
  await expect(slots.nth(2).locator('.slot-copy b')).toHaveText(firstName!);

  await page.locator('.mode-toggle').click();
  await slots.nth(3).focus();
  const before = await slots.nth(3).evaluate((element: HTMLElement) => element.style.left);
  await page.keyboard.press('ArrowRight');
  const after = await slots.nth(3).evaluate((element: HTMLElement) => element.style.left);
  expect(after).not.toBe(before);
});

test('mobile field and inspector use exclusive full-height views', async ({ page }) => {
  await createCareer(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.pitch-panel')).toBeVisible();
  await page.locator('.mobile-view-switch button').filter({ hasText: /inspektor|inspector/i }).click();
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('.pitch-panel')).toBeHidden();
  await expect(page.locator('.mobile-sticky-actions')).toBeInViewport();
});
