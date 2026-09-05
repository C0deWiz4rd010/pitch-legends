import { expect, test } from '@playwright/test';

test('standalone 3D football renders and accepts movement without creating a career', async ({ page }, info) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.getByRole('link', { name: /sofort spielen|play now/i }).click();
  const pitch = page.locator('canvas[aria-label="Live football pitch"]');
  await expect(pitch).toHaveAttribute('data-renderer', 'three-webgl2', { timeout: 30_000 });
  await expect(page.locator('.graphics-loading')).toHaveCount(0, { timeout: 30_000 });
  await expect(pitch).toHaveAttribute('data-graphics', /drawCalls/, { timeout: 15_000 });
  await page.keyboard.press('KeyJ');
  await expect(pitch).toHaveAttribute('data-match-state', /"rule":"playing"/, { timeout: 15_000 });
  const before = JSON.parse((await pitch.getAttribute('data-match-state'))!);
  await page.keyboard.down('KeyD');
  await page.keyboard.down('ShiftLeft');
  // Passing may select a different receiver. Verify actual controlled velocity,
  // rather than comparing the positions of two different footballers.
  await expect.poll(async () => {
    const state = JSON.parse((await pitch.getAttribute('data-match-state'))!);
    return state.tick > before.tick + 10 && state.vx > 1;
  }, { timeout: 15_000 }).toBe(true);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyD');
  const after = JSON.parse((await pitch.getAttribute('data-match-state'))!);
  expect(after.tick).toBeGreaterThan(before.tick);
  expect(after.vx).toBeGreaterThan(1);
  const graphics = JSON.parse((await pitch.getAttribute('data-graphics'))!);
  expect(graphics.drawCalls).toBeGreaterThan(20);
  expect(graphics.drawCalls).toBeLessThan(250);
  await page.screenshot({ path: info.outputPath('three-playground.png'), fullPage: false });
  const careerKeys = await page.evaluate(() => Object.keys(localStorage).filter(key => /pitch-legends:(save|match-checkpoint)/.test(key)));
  expect(careerKeys).toEqual([]);
  expect(errors).toEqual([]);
});
