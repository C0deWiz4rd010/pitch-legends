import { expect,test } from '@playwright/test';

test('quick play exposes independent audio controls without requiring a career',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/play');
  await expect(page.locator('.graphics-loading')).toHaveCount(0,{timeout:30_000});
  await page.getByRole('button',{name:'AUDIO',exact:true}).click();
  const panel=page.getByRole('region',{name:'Audio'});
  await expect(panel).toBeVisible();
  await panel.getByRole('slider',{name:'Effects',exact:true}).fill('0');
  await expect(panel.getByRole('slider',{name:'Music',exact:true})).toHaveValue('0.35');
  await panel.getByRole('slider',{name:'Crowd',exact:true}).fill('0.2');
  const music=panel.getByRole('slider',{name:'Music',exact:true});
  await music.focus();await page.keyboard.press('ArrowRight');
  await expect(music).toHaveValue('0.4');
  await panel.getByRole('checkbox').uncheck();
  await expect(panel.getByRole('checkbox')).not.toBeChecked();
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>/pitch-legends:(save|match-checkpoint)/.test(key)))).toEqual([]);
  expect(errors).toEqual([]);
});
