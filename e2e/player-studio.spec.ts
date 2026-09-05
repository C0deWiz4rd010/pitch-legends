import { expect, test } from '@playwright/test';

test('procedural studio shares portraits and changes identity, kits and animation', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('link', {name:/spieler entdecken|meet the players/i}).click();
  await expect(page.getByRole('heading',{name:/jeder spieler/i})).toBeVisible();
  const canvas = page.getByRole('img', {name:'Animierte 3D-Spieleransicht'});
  await expect(page.locator('canvas')).toHaveAttribute('data-ready','true');
  const portrait = page.getByAltText('Portrait der ausgewählten Spielfigur');
  await expect(portrait).toHaveAttribute('src',/^data:image\/png/, {timeout:30_000});
  const first = await portrait.getAttribute('src');
  await page.getByRole('button',{name:'Spieler 8',exact:true}).click();
  await expect.poll(() => portrait.getAttribute('src')).not.toBe(first);
  await page.getByLabel('Bewegung',{exact:true}).selectOption('shot');
  await page.getByLabel('Tempo',{exact:true}).selectOption({label:'Zeitlupe · ¼'});
  await page.screenshot({path:info.outputPath('player-studio.png')});
  await page.getByLabel('Trikot',{exact:true}).selectOption({label:'Sunset · Auswärts'});
  await expect(page.getByLabel('Spieler-Seed')).toHaveValue('7');
  await page.getByRole('link',{name:/auf den platz/i}).click();
  await expect(page.locator('canvas[aria-label="Live football pitch"]')).toHaveAttribute('data-renderer','three-webgl2',{timeout:30_000});
  expect(errors).toEqual([]);
});
