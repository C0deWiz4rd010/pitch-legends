import { expect, Page, test } from '@playwright/test';

async function enterMatch(page: Page): Promise<void> {
  const handbook = page.locator('dialog[open]');
  await handbook.waitFor({ state: 'visible', timeout: 2_500 }).catch(() => undefined);
  if (await handbook.isVisible()) await handbook.getByRole('button', { name: /verstanden|got it/i }).click();
  await expect(page.locator('canvas[aria-label="Live football pitch"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.graphics-loading')).toHaveCount(0, { timeout: 30_000 });
}

test('Legends Team, quick five-a-side and a challenge run without touching the career', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Legends Team: found a club, open a pack, put a new card into the eleven, play Rivals.
  await page.getByRole('link', { name: /legends team/i }).click();
  await page.getByRole('button', { name: /starten|start/i }).click();
  await page.getByRole('tab', { name: /packs/i }).click();
  await page.getByRole('button', { name: /öffnen|open/i }).first().click();
  await page.getByRole('button', { name: /alle aufdecken|reveal all/i }).click().catch(() => undefined);
  await page.getByRole('button', { name: /zur sammlung|to collection/i }).click();
  const packCard = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('pitch-legends:legends:v1')!);
    return state.cards[state.cards.length - 1];
  });
  await page.getByRole('tab', { name: /^team$/i }).click();
  const slot = await page.evaluate((card) => {
    const order = ['GK', 'LB', 'LCB', 'RCB', 'RB', 'CDM', 'CM', 'CM', 'LW', 'ST', 'RW'];
    const group: Record<string, string[]> = { GK: ['GK'], DEF: ['LB', 'LCB', 'RCB', 'RB'], MID: ['CDM', 'CM'], ATT: ['LW', 'ST', 'RW'] };
    return order.findIndex((position) => group[card.player.positionGroup].includes(position));
  }, packCard);
  await page.locator('.slot').nth(slot).click();
  await page.locator('.picker .card-button').filter({ hasText: packCard.player.lastName }).first().click();
  await expect.poll(() => page.evaluate((id) => JSON.parse(localStorage.getItem('pitch-legends:legends:v1')!).squad.slots.includes(id), packCard.id)).toBe(true);
  await page.getByRole('tab', { name: /übersicht|hub/i }).click();
  await page.getByRole('button', { name: /rivals-spiel|rivals match/i }).click();
  await page.getByRole('button', { name: 'SIM', exact: true }).click();
  await page.getByRole('button', { name: /anpfiff/i }).click();
  await expect(page.locator('.report-tabs')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /ergebnis übernehmen|continue/i }).click();
  await expect(page.locator('.report')).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pitch-legends:legends:v1')!).rivals.played)).toBe(1);

  // Quick match in the five-a-side cage.
  await page.goto('/quick');
  await page.getByRole('button', { name: /5 v 5/i }).click();
  await page.getByRole('button', { name: /anstoss|kick off/i }).click();
  await enterMatch(page);
  await expect.poll(async () => JSON.parse(await page.locator('canvas[aria-label="Live football pitch"]').getAttribute('data-match-state') ?? '{}').activePlayers, { timeout: 10_000 }).toBe(10);

  // Penalty challenge: five kicks, a result card and a stored personal best.
  await page.goto('/challenges');
  await page.locator('.card').filter({ hasText: /elfmeter|penalties/i }).getByRole('button', { name: /starten|start/i }).click();
  await enterMatch(page);
  await expect(page.locator('.challenge-hud')).toBeVisible();
  for (let kick = 0; kick < 5; kick++) {
    await page.keyboard.press('KeyL');
    await page.waitForTimeout(3_200);
  }
  await expect(page.locator('.challenge-result')).toBeVisible({ timeout: 40_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pitch-legends:challenges:v1')!).penalty.attempts)).toBe(1);

  // None of it created or changed a career.
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('pitch-legends:save')))).toEqual([]);
  expect(errors).toEqual([]);
});
