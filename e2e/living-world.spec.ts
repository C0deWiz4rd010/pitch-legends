import { expect, Page, test } from '@playwright/test';

async function createSeededCareer(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder('Alex Stone').fill('Atlas Coach');
  await page.getByPlaceholder('Harbour City').fill('Northstar AFC');
  await page.getByPlaceholder('HBC').fill('NSA');
  await page.locator('.world-studio input[type="number"]').fill('441407');
  await page.getByRole('button', { name: /gegenpress/i }).click();
  await page.getByRole('button', { name: /karriere starten|start career/i }).click();
  await expect(page.locator('.match-stage')).toBeVisible();
}

test('seeded league atlas exposes clubs, cities, routes and individual coaches', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await createSeededCareer(page);

  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('pitch-legends:save:v5')!));
  expect(state.version).toBe(5);
  expect(state.world.seed).toBe(441407);
  expect(state.world.cities).toHaveLength(12);
  expect(state.managers).toHaveLength(11);

  await page.goto('/league');
  await page.getByRole('button', { name: /^(karte|map)$/i }).click();
  await expect(page.locator('.world-map')).toBeVisible();
  await expect(page.locator('.world-map .city')).toHaveCount(12);
  expect(await page.locator('.world-map .region').count()).toBeGreaterThanOrEqual(4);
  expect(await page.locator('.world-map .routes line').count()).toBeGreaterThan(11);
  await expect(page.locator('.map-dossier app-manager-portrait')).toBeVisible();
  await page.locator('.world-map .city').nth(1).click();
  await expect(page.locator('.map-dossier h2')).not.toHaveText('Northstar AFC');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test('medical dossier survives save/load and keeps the unified player visuals', async ({ page }) => {
  await createSeededCareer(page);
  const injuredPlayerName = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('pitch-legends:save:v5')!);
    const club = state.teams.find((team: any) => team.id === state.clubId);
    const player = club.players[0];
    player.injuryWeeks = 3;
    player.medical = {
      activeInjury: {
        id: 'qa-injury', diagnosisId: 'ankle-sprain', area: 'ankle', severity: 'moderate', cause: 'training',
        fixtureId: null, matchMinute: null, initialWeeks: 3, remainingWeeks: 3, rehabPlan: 'standard',
        recurrenceRisk: 0.09, returnFitness: 75, occurredSeason: 1, occurredWeek: 1,
      },
      history: [], recurrenceUntilWeek: null,
    };
    localStorage.setItem('pitch-legends:save:v5', JSON.stringify(state));
    return `${player.firstName} ${player.lastName}`;
  });
  await page.goto('/squad');
  await page.reload();
  await page.locator('.pcard').filter({ hasText: injuredPlayerName }).click();
  await expect(page.locator('.medical-panel')).toContainText(/ankle-sprain/i);
  await expect(page.locator('.player-visuals img')).toHaveCount(2);
  const images = page.locator('.player-visuals img');
  for (let index = 0; index < 2; index++) {
    expect(await images.nth(index).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  }
  await page.getByRole('button', { name: /schonung/i }).click();
  await expect(page.getByRole('button', { name: /schonung/i })).toHaveClass(/active/);
});
