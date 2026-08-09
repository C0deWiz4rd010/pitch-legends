import { expect, Page, test } from '@playwright/test';

async function createCareer(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder('Alex Stone').fill('Gameplay Tester');
  await page.getByPlaceholder('Harbour City').fill('Turbo Pixels');
  await page.getByPlaceholder('HBC').fill('TRB');
  await page.getByRole('button', { name: /karriere starten|start career/i }).click();
  await expect(page.locator('.match-stage')).toBeVisible();
}

test('real match accepts the full keyboard flow and keeps smooth frame pacing', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await createCareer(page);
  await page.goto('/match');
  await page.getByRole('button', { name: /anpfiff/i }).click();
  await page.getByRole('button', { name: /intro/i }).click();
  const handbook = page.locator('dialog[open]');
  await handbook.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  if (await handbook.isVisible()) await handbook.getByRole('button', { name: /verstanden|got it/i }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const metrics = { frames: [] as number[], longTasks: [] as number[], last: 0, active: true };
    (window as any).__matchQaMetrics = metrics;
    const sample = (time: number) => {
      if (!metrics.active) return;
      if (metrics.last) metrics.frames.push(time - metrics.last);
      metrics.last = time;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    if ('PerformanceObserver' in window) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (entry.duration > 50) metrics.longTasks.push(entry.duration);
      });
      try { observer.observe({ type: 'longtask', buffered: false }); } catch { /* unsupported browser */ }
      (window as any).__matchQaObserver = observer;
    }
  });

  await page.keyboard.down('KeyD');
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(650);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyD');
  for (const key of ['KeyJ', 'KeyK', 'KeyU', 'KeyL', 'Space']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(140);
  }
  await page.keyboard.press('KeyQ');
  await expect(page.locator('.quick-wheel')).toBeVisible();
  await page.keyboard.press('KeyQ');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-layer')).toBeVisible();
  await page.getByRole('button', { name: /weiterspielen/i }).click();
  const auto = page.locator('.auto-chip');
  await auto.click();
  await expect(auto).toContainText(/ki steuert/i);
  await page.waitForTimeout(900);
  await auto.click();
  await expect(auto).toContainText(/aus/i);
  await page.waitForTimeout(2_500);

  const metrics = await page.evaluate(() => {
    const value = (window as any).__matchQaMetrics as { frames: number[]; longTasks: number[]; active: boolean };
    value.active = false;
    (window as any).__matchQaObserver?.disconnect();
    const sorted = value.frames.slice(5).sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    return { count: sorted.length, p95: percentile(0.95), p99: percentile(0.99), longTasks: value.longTasks };
  });
  const scoreText = await page.locator('.sb-score').innerText();

  expect(metrics.count).toBeGreaterThan(100);
  expect(metrics.p95).toBeLessThanOrEqual(20);
  expect(metrics.p99).toBeLessThanOrEqual(35);
  expect(metrics.longTasks).toEqual([]);
  expect(scoreText).not.toContain("0' ·");
  expect(errors).toEqual([]);
});
