import { expect, Page, test } from '@playwright/test';

async function createCareer(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder('Alex Stone').fill('Pixel Coach');
  await page.getByPlaceholder('Harbour City').fill('Neon Harbour');
  await page.getByPlaceholder('HBC').fill('NHC');
  const buttons = page.locator('button');
  const labels = await buttons.allTextContents();
  const startIndex = labels.findIndex((label) => /start|karriere|begin/i.test(label));
  expect(startIndex).toBeGreaterThanOrEqual(0);
  await buttons.nth(startIndex).click();
  await expect(page.locator('.match-stage')).toBeVisible();
}

test('command centre stays responsive and keeps the primary match action visible', async ({ page }) => {
  await createCareer(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.match-stage .primary-action').first()).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});

test('handbook exposes the real pass binding and keeps focus inside its native dialog', async ({ page }) => {
  await createCareer(page);
  await page.getByRole('button', { name: /steuerung/i }).first().click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/J DRÜCKEN = KURZPASS/i);
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('player identity loads offline and live AUTO remains reversible', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await createCareer(page);
  await page.goto('/squad');
  await page.locator('.pcard').first().click();
  const portrait = page.locator('.player-visuals img').first();
  await expect(portrait).toHaveAttribute('src', /^data:image\/svg\+xml/);
  expect(await portrait.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);

  await page.goto('/');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole('link', { name: /auto-match/i }).click();
  await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
  const auto = page.locator('.auto-chip');
  await expect(auto).toContainText('KI STEUERT');
  await auto.click();
  await expect(auto).toContainText('AUS');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});
