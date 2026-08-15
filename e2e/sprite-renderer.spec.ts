import { expect, Page, test } from '@playwright/test';

async function startMatch(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder('Alex Stone').fill('Sprite Tester');
  await page.getByPlaceholder('Harbour City').fill('Sprite City');
  await page.getByPlaceholder('HBC').fill('SP2');
  await page.locator('button').filter({ hasText: /start|karriere|begin/i }).first().click();
  await page.goto('/match');
  await page.getByRole('button', { name: /anpfiff/i }).click();
  await page.getByRole('button', { name: /intro/i }).click();
  const handbook = page.locator('dialog[open]');
  await handbook.waitFor({ state: 'visible', timeout: 1500 }).catch(() => undefined);
  if (await handbook.isVisible()) await handbook.getByRole('button', { name: /verstanden|got it/i }).click();
  await expect(page.locator('canvas')).toBeVisible();
}

test('48x48 V3 footballers render through live locomotion without canvas errors', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await startMatch(page);
  await page.waitForTimeout(1200);
  const canvas = page.locator('canvas');
  const colourCount = await canvas.evaluate((element: HTMLCanvasElement) => {
    const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    const colours = new Set<string>();
    for (let offset = 0; offset < pixels.length; offset += 64) colours.add(`${pixels[offset]}:${pixels[offset + 1]}:${pixels[offset + 2]}:${pixels[offset + 3]}`);
    return colours.size;
  });
  expect(colourCount).toBeGreaterThan(45);
  await page.screenshot({ path: testInfo.outputPath('sprite-v3-live.png'), fullPage: false });
  expect(errors).toEqual([]);
});
