import { expect, test } from '@playwright/test';

test('live handbook pauses play, releases held movement and closes without toggling pause', async ({ page }) => {
  await page.goto('/play');
  const pitch = page.locator('canvas[aria-label="Live football pitch"]');
  await expect(pitch).toHaveAttribute('data-renderer', 'three-webgl2', { timeout: 30_000 });
  await expect(page.locator('.graphics-loading')).toHaveCount(0, { timeout: 30_000 });
  await page.keyboard.down('KeyD');
  await page.getByRole('button', { name: '? STEUERUNG', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await page.keyboard.up('KeyD');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.pause-layer')).toHaveCount(0);
  await expect.poll(async () => {
    const state = JSON.parse((await pitch.getAttribute('data-match-state')) || '{}');
    return Math.hypot(state.vx ?? 100, state.vy ?? 100);
  }, { timeout: 7_000 }).toBeLessThan(.1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-layer')).toBeVisible();
  await page.locator('.pause-layer').getByRole('button', { name: /steuerung/i }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.pause-layer')).toBeVisible();
});
