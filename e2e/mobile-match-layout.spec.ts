import { expect, Page, test } from '@playwright/test';

async function createCareer(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder('Alex Stone').fill('Mobile Tester');
  await page.getByPlaceholder('Harbour City').fill('Safe Area FC');
  await page.getByPlaceholder('HBC').fill('SAF');
  await page.getByRole('button', { name: /karriere starten|start career/i }).click();
  await expect(page.locator('.match-stage')).toBeVisible();
}

test.describe('mobile landscape match chrome', () => {
  test.use({
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });

  test('locks the pitch to the visual viewport and keeps compact controls clear', async ({ page }, testInfo) => {
    await createCareer(page);
    await page.goto('/match');
    await page.getByRole('button', { name: /anpfiff/i }).click();
    await page.getByRole('button', { name: /intro/i }).click();

    const handbook = page.locator('dialog[open]');
    await handbook.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
    if (await handbook.isVisible()) await handbook.getByRole('button', { name: /verstanden|got it/i }).click();

    await expect(page.locator('body')).toHaveClass(/match-immersive/);
    await expect(page.locator('.fullscreen-chip')).toBeVisible();
    await expect(page.locator('.touch-controls')).toBeVisible();

    const layout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const bounds = document.querySelector(selector)!.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
      };
      const actionButtons = [...document.querySelectorAll<HTMLElement>('.touch-actions button')].map((button) => {
        const bounds = button.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
      });
      const interactiveArea = [rect('.touch-stick'), ...actionButtons]
        .reduce((sum, item) => sum + item.width * item.height, 0);
      const overlaps = actionButtons.some((first, index) => actionButtons.slice(index + 1).some((second) =>
        Math.min(first.right, second.right) > Math.max(first.left, second.left)
        && Math.min(first.bottom, second.bottom) > Math.max(first.top, second.top),
      ));
      const content = document.querySelector<HTMLElement>('main.content')!;
      content.scrollTop = 200;
      content.scrollLeft = 200;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        wrapper: rect('.canvas-wrap'),
        scoreboard: rect('.scoreboard'),
        fullscreen: rect('.fullscreen-chip'),
        auto: rect('.auto-chip'),
        stick: rect('.touch-stick'),
        actionButtons,
        interactiveRatio: interactiveArea / (innerWidth * innerHeight),
        overlaps,
        contentScroll: { top: content.scrollTop, left: content.scrollLeft, width: content.scrollWidth, clientWidth: content.clientWidth, height: content.scrollHeight, clientHeight: content.clientHeight },
        documentOverflow: {
          horizontal: document.documentElement.scrollWidth > innerWidth,
          vertical: document.documentElement.scrollHeight > innerHeight,
        },
      };
    });

    expect(layout.wrapper).toMatchObject({ left: 0, top: 0, right: 844, bottom: 390 });
    expect(layout.contentScroll).toEqual({ top: 0, left: 0, width: 844, clientWidth: 844, height: 390, clientHeight: 390 });
    expect(layout.documentOverflow).toEqual({ horizontal: false, vertical: false });
    expect(layout.overlaps).toBe(false);
    expect(layout.interactiveRatio).toBeLessThan(0.05);

    for (const control of [layout.fullscreen, layout.auto, layout.stick, ...layout.actionButtons]) {
      expect(control.left).toBeGreaterThanOrEqual(0);
      expect(control.top).toBeGreaterThanOrEqual(0);
      expect(control.right).toBeLessThanOrEqual(layout.viewport.width);
      expect(control.bottom).toBeLessThanOrEqual(layout.viewport.height);
    }
    expect(layout.fullscreen.right).toBeLessThan(layout.scoreboard.left);
    expect(layout.auto.left).toBeGreaterThan(layout.scoreboard.right);

    if (process.env['MOBILE_MATCH_SCREENSHOT']) {
      await page.screenshot({ path: testInfo.outputPath('mobile-match-layout.png') });
    }

    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.locator('main.content').evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft })))
      .toEqual({ top: 0, left: 0 });
  });
});
