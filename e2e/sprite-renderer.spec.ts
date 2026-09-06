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
  await expect(page.locator('canvas[aria-label="Live football pitch"]')).toBeVisible();
}

test('career football uses the shared 3D renderer and all 22 active players', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await startMatch(page);
  await page.waitForTimeout(1200);
  const canvas = page.locator('canvas[aria-label="Live football pitch"]');
  await expect(canvas).toHaveAttribute('data-renderer','three-webgl2',{timeout:30_000});
  await expect(canvas).toHaveAttribute('data-match-state',/"activePlayers":22/,{timeout:15_000});
  await page.keyboard.down('KeyD');
  await expect.poll(async()=>{ const state=JSON.parse((await canvas.getAttribute('data-match-state'))!); return state.vx*state.attackDirection; },{timeout:15_000}).toBeGreaterThan(1);
  await page.keyboard.up('KeyD');
  const layout = await page.evaluate(() => {
    const score = document.querySelector('.scoreboard')!.getBoundingClientRect();
    const pitch = document.querySelector('canvas[aria-label="Live football pitch"]')!.getBoundingClientRect();
    return {scoreCenter:score.left+score.width/2,center:innerWidth/2,pitchWidth:pitch.width,pitchHeight:pitch.height,width:innerWidth,height:innerHeight};
  });
  expect(Math.abs(layout.scoreCenter-layout.center)).toBeLessThan(2);
  expect(layout.pitchWidth).toBe(layout.width);
  expect(layout.pitchHeight).toBe(layout.height);
  await page.getByRole('button',{name:'KAMERA · ARCADE'}).click();
  await expect(page.getByRole('button',{name:'KAMERA · TV'})).toBeVisible();
  await page.getByRole('button',{name:'KAMERA · TV'}).click();
  await page.getByRole('button',{name:'KAMERA · TAKTIK'}).click();
  await page.screenshot({ path: testInfo.outputPath('career-three-live.png'), fullPage: false });
  expect(errors).toEqual([]);
});
