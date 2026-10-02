import { expect, Page, test } from '@playwright/test';

const KEY = 'pitch-legends:save:v6';

/** Edits the stored career and reloads, so the app picks the change up like a returning player. */
async function editSave(page: Page, edit: (state: any) => void): Promise<void> {
  await page.waitForTimeout(400);
  await page.evaluate(([key, source]) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    new Function('state', `(${source})(state)`)(state);
    localStorage.setItem(key, JSON.stringify(state));
  }, [KEY, edit.toString()]);
  await page.reload();
}

test('second-division career: cup tie, season review, promotion table and archive', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder('Alex Stone').fill('Cup Runner');
  await page.getByPlaceholder('Harbour City').fill('Northstar AFC');
  await page.getByPlaceholder('HBC').fill('NSA');
  await page.getByRole('button', { name: /2\. LIGA|DIVISION 2/ }).click();
  await page.getByRole('button', { name: /karriere starten|start career/i }).click();
  await expect(page.locator('.match-stage')).toBeVisible();

  // Week 3 hosts the first cup round; second-division clubs never get a bye.
  await editSave(page, (state) => {
    for (const league of [state.league, ...state.otherLeagues]) {
      for (const fixture of league.fixtures) if (fixture.week < 3) { fixture.played = true; fixture.homeScore = 1; fixture.awayScore = 0; }
      league.currentWeek = 3;
    }
  });
  await expect(page.locator('.eyebrow.cup')).toContainText(/1\. Runde|Round 1/);
  await page.goto('/match');
  await expect(page.locator('.cup-eyebrow')).toBeVisible();
  await page.getByRole('button', { name: 'SIM', exact: true }).click();
  await page.getByRole('button', { name: /anpfiff/i }).click();
  await expect(page.locator('.report-tabs')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /karriere fortsetzen|continue career/i }).click();
  await expect(page.locator('.match-stage')).toBeVisible();
  // The cup tie keeps the week; the autosave lands shortly after the commit.
  await expect.poll(() => page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key)!);
    return { week: state.league.currentWeek, roundOnePlayed: state.cup.ties.filter((tie: any) => tie.round === 1).every((tie: any) => tie.played), roundTwo: state.cup.ties.some((tie: any) => tie.round === 2) };
  }, KEY)).toEqual({ week: 3, roundOnePlayed: true, roundTwo: true });

  await page.goto('/league');
  await expect(page.locator('.division-switch button')).toHaveCount(2);
  await page.getByRole('tab', { name: /pokal|cup/i }).click();
  await expect(page.locator('.bracket-round')).toHaveCount(5);

  // Finish the season on paper and close it in the review.
  await editSave(page, (state) => {
    for (const league of [state.league, ...state.otherLeagues]) {
      league.fixtures.forEach((fixture: any, index: number) => { if (!fixture.played) { fixture.played = true; fixture.homeScore = (index * 7) % 4; fixture.awayScore = (index * 3) % 3; } });
    }
    for (const tie of state.cup.ties) if (!tie.played) { tie.played = true; tie.homeScore = 2; tie.awayScore = 1; tie.winnerId = tie.homeTeamId; }
    state.cup.winnerId = state.cup.ties[state.cup.ties.length - 1].winnerId;
  });
  await page.goto('/season-review');
  await expect(page.locator('.champions .winner')).toHaveCount(3);
  await expect(page.locator('.objectives li')).toHaveCount(5);
  await page.getByRole('button', { name: /neue saison|start next season|angebot annehmen|accept offer/i }).click();
  await expect(page.locator('.match-stage')).toBeVisible();
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).league.season, KEY)).toBe(2);
  await page.goto('/league');
  await page.getByRole('tab', { name: /archiv|archive/i }).click();
  await expect(page.locator('.archive-row')).toHaveCount(1);
  await page.goto('/finances');
  await expect(page.locator('.kpis p')).toHaveCount(5);
  await page.goto('/academy');
  await expect(page.locator('.prospect').first()).toBeVisible();
  expect(errors).toEqual([]);
});
