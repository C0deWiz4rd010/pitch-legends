import { expect, test } from '@playwright/test';
import { collectErrors } from './console';

test('procedural studio shares portraits and changes identity, kits and animation', { tag: '@cross' }, async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
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
  await page.getByRole('button',{name:'Kraftschuss',exact:true}).click();
  await expect(page.getByRole('button',{name:'Kraftschuss',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Zeitlupe ¼',exact:true}).click();
  await page.screenshot({path:info.outputPath('player-studio.png')});
  await page.getByRole('button',{name:'Hechten',exact:true}).click();
  await page.getByLabel('Bewegungsablauf',{exact:true}).fill('0.24');
  await expect(page.getByRole('button',{name:'▶ Abspielen'})).toBeVisible();
  await page.screenshot({path:info.outputPath('goalkeeper-dive.png')});
  await page.getByRole('button',{name:'Fangen',exact:true}).click();
  await page.getByLabel('Bewegungsablauf',{exact:true}).fill('0.25');
  await page.screenshot({path:info.outputPath('goalkeeper-catch.png')});
  await page.getByRole('button',{name:'Sunset · Auswärts',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sunset · Auswärts',exact:true})).toHaveAttribute('aria-pressed','true');
  // The whole figure stays inside the stage, above the transport bar.
  const stage = await page.locator('.stage').boundingBox();
  expect(stage!.y + stage!.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) + 1);
  await expect(page.getByLabel('Spieler-Seed')).toHaveValue('7');
  await page.getByRole('link',{name:/auf den platz/i}).click();
  await expect(page.locator('canvas[aria-label="Live football pitch"]')).toHaveAttribute('data-renderer','three-webgl2',{timeout:30_000});
  expect(errors).toEqual([]);
});
