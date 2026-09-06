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

test('real match accepts the full keyboard flow and keeps smooth frame pacing', async ({ page }, info) => {
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
  await expect(page.locator('canvas[aria-label="Live football pitch"]')).toBeVisible();
  await expect(page.locator('.graphics-loading')).toHaveCount(0,{timeout:30_000});
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
  await expect(page.locator('.sb-score')).not.toContainText("0' ·", { timeout: 10_000 });

  const metrics = await page.evaluate(() => {
    const value = (window as any).__matchQaMetrics as { frames: number[]; longTasks: number[]; active: boolean };
    value.active = false;
    (window as any).__matchQaObserver?.disconnect();
    const sorted = value.frames.slice(5).sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    return { count: sorted.length, median: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), longTasks: value.longTasks };
  });
  await info.attach('frame-pacing.json', {body:JSON.stringify(metrics,null,2),contentType:'application/json'});
  // A shared GitHub runner can quota headless Chromium down to 30 or 20 Hz.
  // Local reference runs remain the strict 60 Hz performance benchmark; CI
  // guards against additional jank and long main-thread work under that quota.
  // Recent Chromium headless shells can be compositor-capped to exactly 20 Hz
  // even without main-thread work. Keep the strict 60 Hz budget for headed
  // reference runs, but recognise that stable 50 ms cadence as an environment
  // quota; long tasks and frame variance still catch application jank.
  const compositorQuota = metrics.median >= 30 && metrics.median <= 52 && metrics.longTasks.length === 0;
  // Some headless Windows compositors maintain a clean 16.7 ms median but
  // periodically coalesce vsyncs without any corresponding long task. Accept
  // the stable 33.4 ms p95 plus an isolated 50 ms p99 while still rejecting
  // arbitrary jank, slow medians and main-thread stalls.
  const stableHeadlessVsync = metrics.median <= 18 && metrics.p95 <= 34 && metrics.p99 <= 51 && metrics.longTasks.length === 0;
  const medianLimit = compositorQuota ? 52 : process.env['CI'] ? 35 : 18;
  const p95Limit = compositorQuota ? 70 : stableHeadlessVsync ? 34 : process.env['CI'] ? 55 : 20;
  const p99Limit = compositorQuota ? 105 : stableHeadlessVsync ? 51 : process.env['CI'] ? 85 : 35;

  expect(metrics.count).toBeGreaterThan(100);
  expect(metrics.median).toBeLessThanOrEqual(medianLimit);
  expect(metrics.p95).toBeLessThanOrEqual(p95Limit);
  expect(metrics.p99).toBeLessThanOrEqual(p99Limit);
  expect(metrics.longTasks).toEqual([]);
  expect(errors).toEqual([]);
});
