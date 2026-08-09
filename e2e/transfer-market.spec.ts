import { expect, Page, test } from '@playwright/test';

async function createCareer(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder('Alex Stone').fill('Market Tester');
  await page.getByPlaceholder('Harbour City').fill('Neon Athletic');
  await page.getByPlaceholder('HBC').fill('NEO');
  await page.getByRole('button', { name: /karriere starten|start career/i }).click();
  await expect(page.locator('.match-stage')).toBeVisible();
}

test('transfer hub supports search, shortlist and a complete free-agent signing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await createCareer(page);
  await page.goto('/transfer');
  await expect(page.locator('.market-shell')).toBeVisible();
  await expect(page.locator('.player-row').first()).toBeVisible();
  await expect(page.locator('.player-dossier')).toBeVisible();

  const freeAgent = page.locator('.player-row').filter({ hasText: /vereinslos|free agent/i }).first();
  await expect(freeAgent).toBeVisible();
  await freeAgent.click();
  await page.locator('.dossier-actions').getByRole('button', { name: /beobachten|watch/i }).click();
  await expect(page.locator('.market-tabs')).toContainText('1');
  await page.locator('.dossier-actions').getByRole('button', { name: /vertragsangebot|contract offer/i }).click();
  await expect(page.locator('.deal-dialog[open]')).toBeVisible();
  await page.getByRole('button', { name: /angebot senden|submit offer/i }).click();
  await expect(page.locator('.deal-dialog[open]')).toContainText(/spielervertrag|player contract/i);
  await page.getByRole('button', { name: /vertrag senden|send contract/i }).click();
  await expect(page.locator('.market-message')).toContainText(/wechselt|joins/i);
  expect(errors).toEqual([]);
});

test('transfer hub stays usable without horizontal page overflow', async ({ page }) => {
  await createCareer(page);
  await page.goto('/transfer');
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.market-tabs')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
});
