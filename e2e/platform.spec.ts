import { expect, Page, test } from '@playwright/test';
import { readStore, resetStorage, seedStore } from './storage';

const CAREER = 'pitch-legends:save:v6';
const production = process.env['PLAYWRIGHT_PRODUCTION'] === '1';

async function createCareer(page: Page, name = 'Platform Tester'): Promise<void> {
  await page.goto('/');
  await resetStorage(page);
  await page.reload();
  await page.getByPlaceholder('Alex Stone').fill(name);
  await page.getByPlaceholder('Harbour City').fill('Offline FC');
  await page.getByPlaceholder('HBC').fill('OFC');
  await page.getByRole('button', { name: /karriere starten|start career/i }).click();
  await expect(page.locator('.match-stage')).toBeVisible();
  await expect.poll(() => readStore(page, CAREER).then((state) => state?.managerName)).toBe(name);
}

test('saves live in IndexedDB and older localStorage saves are moved over', async ({ page }) => {
  await createCareer(page);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('pitch-legends:')))).toEqual([]);
  // A save written by an older version reappears after the next load, and leaves localStorage.
  const state = await readStore(page, CAREER);
  state.managerName = 'Imported From LocalStorage';
  await seedStore(page, CAREER, state);
  await page.reload();
  await expect(page.locator('.match-stage')).toBeVisible();
  await expect.poll(() => readStore(page, CAREER).then((saved) => saved?.managerName)).toBe('Imported From LocalStorage');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pitch-legends:save:v6'))).toBeNull();
});

test('a damaged career is kept, reported and can be replaced by the last backup', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await createCareer(page, 'Backup Owner');
  // The next start records the career as the last good backup.
  await page.reload();
  await expect(page.locator('.match-stage')).toBeVisible();
  await expect.poll(() => readStore(page, 'pitch-legends:backup:career-last-good').then((backup) => backup?.managerName)).toBe('Backup Owner');

  await page.evaluate(() => localStorage.setItem('pitch-legends:save:v6', '{"version":6,"clubId":'));
  await page.reload();
  const recovery = page.locator('.recovery');
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText(/beschädigt|damaged/i);
  // Nothing was thrown away: the damaged file is still stored and also kept as a copy.
  const raw = await page.evaluate(() => new Promise<string | null>((resolve) => {
    const open = indexedDB.open('pitch-legends');
    open.onsuccess = () => {
      const get = open.result.transaction('backups').objectStore('backups').get('pitch-legends:backup:career-corrupt');
      get.onsuccess = () => { open.result.close(); resolve(get.result ?? null); };
    };
  }));
  expect(raw).toBe('{"version":6,"clubId":');

  await recovery.getByRole('button', { name: /letzte sicherung laden|load last backup/i }).click();
  await expect(page.locator('.match-stage')).toBeVisible();
  await expect.poll(() => readStore(page, CAREER).then((state) => state?.managerName)).toBe('Backup Owner');
  expect(errors).toEqual([]);
});

test('a full disk shows a visible message with export and retry', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if ((window as any).__simulateFullDisk && String(key).startsWith('pitch-legends:save:')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await createCareer(page);
  await page.evaluate(() => { (window as any).__simulateFullDisk = true; });
  await page.goto('/settings');
  await page.evaluate(() => { (window as any).__simulateFullDisk = true; });
  await page.getByRole('button', { name: /jetzt speichern|save now/i }).click();
  const notice = page.locator('app-system-notices .notice.danger');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/speicher voll|storage full/i);
  await expect(notice.getByRole('button', { name: /exportieren|export/i })).toBeVisible();
  await page.evaluate(() => { (window as any).__simulateFullDisk = false; });
  await notice.getByRole('button', { name: /erneut|retry/i }).click();
  await expect(notice).toHaveCount(0);
});

test('keys can be rebound and the new shot key takes the penalty', async ({ page }) => {
  await page.goto('/');
  await resetStorage(page);
  await page.goto('/controls');
  const passRow = page.locator('.row').filter({ hasText: /kurzpass|short pass/i });
  await passRow.getByRole('button', { name: /ändern|change/i }).click();
  await page.keyboard.press('KeyP');
  await expect(passRow.locator('kbd')).toHaveText('P');
  await passRow.getByRole('button', { name: /ändern|change/i }).click();
  await page.keyboard.press('KeyL');
  await expect(page.locator('.message')).toContainText(/schuss|shoot/i);
  await expect(page.locator('.row').filter({ hasText: /schuss \/ befreiung|shoot \/ clearance/i }).locator('kbd')).toHaveText('P');
  await passRow.getByRole('button', { name: /ändern|change/i }).click();
  await page.keyboard.press('Escape');
  await expect(passRow.locator('kbd')).toHaveText('L');
  await expect.poll(() => readStore(page, 'pitch-legends:controls:v1').then((prefs) => prefs?.keyboard)).toEqual({ pass: 'KeyL', shoot: 'KeyP' });

  // The rebound shot fires on P in a match.
  await page.goto('/challenges');
  await page.locator('.card').filter({ hasText: /elfmeter|penalties/i }).getByRole('button', { name: /starten|start/i }).click();
  const handbook = page.locator('dialog[open]');
  await handbook.waitFor({ state: 'visible', timeout: 2_500 }).catch(() => undefined);
  if (await handbook.isVisible()) await handbook.getByRole('button', { name: /verstanden|got it/i }).click();
  await expect(page.locator('.graphics-loading')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.challenge-hud')).toBeVisible();
  const pitch = page.locator('canvas[aria-label="Live football pitch"]');
  const rule = async () => JSON.parse((await pitch.getAttribute('data-match-state')) ?? '{}').rule;
  await expect.poll(rule).toBe('penalty');
  // The rebound shot key P takes the penalty (pressed until the taker is ready) …
  await expect.poll(async () => { await page.keyboard.press('KeyP'); await page.waitForTimeout(300); return rule(); }, { timeout: 10_000 }).not.toBe('penalty');
  // … and on the next penalty the old key J does nothing.
  await expect.poll(rule, { timeout: 10_000 }).toBe('penalty');
  await page.waitForTimeout(1_000);
  for (let press = 0; press < 5; press++) { await page.keyboard.press('KeyJ'); await page.waitForTimeout(300); }
  expect(await rule()).toBe('penalty');
});

test.describe('touch layout', () => {
  test.use({ viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('a larger left-handed layout with jockey stays on screen without overlaps', async ({ page }) => {
    await page.goto('/');
    await resetStorage(page);
    await seedStore(page, 'pitch-legends:controls:v1', { version: 1, keyboard: {}, gamepad: {}, touch: { scale: 1.3, opacity: 0.7, lift: 24, leftHanded: true } });
    await page.goto('/play');
    const handbook = page.locator('dialog[open]');
    await handbook.waitFor({ state: 'visible', timeout: 2_500 }).catch(() => undefined);
    if (await handbook.isVisible()) await handbook.getByRole('button', { name: /verstanden|got it/i }).click();
    await expect(page.locator('.graphics-loading')).toHaveCount(0, { timeout: 30_000 });
    const controls = page.locator('.touch-controls');
    await expect(controls).toBeVisible();
    await expect(controls).toHaveClass(/left-handed/);
    await expect(page.getByRole('button', { name: /stellen|jockey/i })).toBeVisible();
    const layout = await page.evaluate(() => {
      const box = (element: Element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
      const buttons = [...document.querySelectorAll('.touch-actions button')].map(box);
      return { stick: box(document.querySelector('.touch-stick')!), buttons, width: innerWidth, height: innerHeight };
    });
    // Left-handed: the buttons sit left of the stick.
    expect(Math.max(...layout.buttons.map((button) => button.right))).toBeLessThan(layout.stick.left);
    for (const control of [layout.stick, ...layout.buttons]) {
      expect(control.left).toBeGreaterThanOrEqual(0);
      expect(control.top).toBeGreaterThanOrEqual(0);
      expect(control.right).toBeLessThanOrEqual(layout.width);
      // The lift keeps everything at least 24 px clear of the bottom edge.
      expect(control.bottom).toBeLessThanOrEqual(layout.height - 24);
    }
    const overlaps = layout.buttons.some((first, index) => layout.buttons.slice(index + 1).some((second) =>
      Math.min(first.right, second.right) > Math.max(first.left, second.left) && Math.min(first.bottom, second.bottom) > Math.max(first.top, second.top)));
    expect(overlaps).toBe(false);
  });
});

test('reloads offline once the service worker has cached the game', async ({ page, context }) => {
  test.skip(!production, 'The service worker only exists in the production build.');
  test.setTimeout(90_000);
  await page.goto('/');
  await resetStorage(page);
  await page.reload();
  // Wait until the worker controls the page and has cached every script of the game.
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) return 0;
    const names = await caches.keys();
    const app = names.find((name) => name.includes(':assets:app:cache'));
    return app ? (await (await caches.open(app)).keys()).length : 0;
  }), { timeout: 45_000 }).toBeGreaterThan(20);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.hero h1')).toContainText('PITCH');
  // Chrome on Linux keeps navigator.onLine true under emulated offline; the notice follows that flag.
  if (await page.evaluate(() => !navigator.onLine)) await expect(page.locator('app-system-notices .notice.offline')).toBeVisible();
  // Lazy routes come from the cache too.
  await page.getByRole('link', { name: /schnellspiel|quick match/i }).click();
  await expect(page.getByRole('button', { name: /anstoss|kick off/i })).toBeVisible();
  await context.setOffline(false);
});
