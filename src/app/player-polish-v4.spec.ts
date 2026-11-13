import * as THREE from 'three';
import { createPlayerVisualIdentity, createClubVisualIdentity } from './core/visual-identity';
import { KIT_PATTERN_ID, kitPatternMask } from './features/match/player-material';
import { FAR_FIGURE_DISTANCE, PlayerMarks, breathDue, farFigure, markPlayer, newMarks, soakLimit } from './features/match/player-traces';
import { createProceduralFootballer } from './features/match/three-player.factory';

const kit = createClubVisualIdentity('Polish', 'POL', '#18bb99', '#102844', 3).kits.home;

describe('Player polish (V6)', () => {
  it('gives every shirt pattern a shader id and a mask with both colours', () => {
    const ids = Object.values(KIT_PATTERN_ID);
    expect(new Set(ids).size).toBe(ids.length);
    expect(KIT_PATTERN_ID.solid).toBe(0);
    for (const pattern of Object.keys(KIT_PATTERN_ID) as (keyof typeof KIT_PATTERN_ID)[]) {
      let on = 0, total = 0;
      for (let u = -0.95; u < 1; u += 0.05) for (let v = 0.02; v < 1; v += 0.04) { total++; if (kitPatternMask(pattern, u, v)) on++; }
      if (pattern === 'solid') expect(on).toBe(0);
      else { expect(on).toBeGreaterThan(total * 0.04); expect(on).toBeLessThan(total * 0.6); }
    }
    expect(kitPatternMask('halves', -0.5, 0.5)).toBe(true);
    expect(kitPatternMask('halves', 0.5, 0.5)).toBe(false);
    expect(kitPatternMask('stripes', 0, 0.5)).toBe(true);
    expect(kitPatternMask('stripes', 0.3, 0.5)).toBe(false);
    expect(kitPatternMask('chest-band', 0.2, 0.66)).toBe(true);
  });

  it('carries surface, pattern and print data on every vertex, and a simpler figure for the distance', () => {
    const model = createProceduralFootballer(createPlayerVisualIdentity('polish-1'), { ...kit, pattern: 'stripes' }, 9, false, false, false, '');
    const geometry = model.mesh.geometry;
    const count = geometry.getAttribute('position').count;
    for (const name of ['kitA', 'kitB', 'printUv']) expect(geometry.getAttribute(name).count).toBe(count);
    const kitA = geometry.getAttribute('kitA');
    let fabric = 0, skin = 0, patterned = 0;
    for (let i = 0; i < count; i++) {
      if (kitA.getW(i) === 1) fabric++;
      if (kitA.getW(i) === 2) skin++;
      if (kitA.getZ(i) === KIT_PATTERN_ID.stripes) { patterned++; expect(Math.abs(kitA.getX(i))).toBeLessThan(1.6); }
    }
    expect(fabric).toBeGreaterThan(100);
    expect(skin).toBeGreaterThan(100);
    expect(patterned).toBeGreaterThan(30);
    // Each player has a material of his own (his traces), all with the same program key.
    const other = createProceduralFootballer(createPlayerVisualIdentity('polish-2'), kit, 4);
    expect(other.mesh.material).not.toBe(model.mesh.material);
    expect((other.mesh.material as THREE.Material).customProgramCacheKey()).toBe((model.mesh.material as THREE.Material).customProgramCacheKey());
    const near = model.mesh.geometry;
    model.setDetail(false);
    const far = model.mesh.geometry;
    expect(far).not.toBe(near);
    expect(far.getAttribute('position').count).toBeLessThan(near.getAttribute('position').count * 0.85);
    expect(far.getAttribute('skinIndex').count).toBe(far.getAttribute('position').count);
    model.setDetail(true);
    expect(model.mesh.geometry).toBe(near);
    model.setTraces({ mud: 0.5, wet: 1, sweat: 0.2, seed: 0.4 });
    model.destroy(); other.destroy();
  });

  it('switches to the distant figure with a margin', () => {
    expect(farFigure(false, FAR_FIGURE_DISTANCE - 1)).toBe(false);
    expect(farFigure(false, FAR_FIGURE_DISTANCE + 1)).toBe(true);
    // Once far, he stays far until he is clearly closer.
    expect(farFigure(true, FAR_FIGURE_DISTANCE - 3)).toBe(true);
    expect(farFigure(true, FAR_FIGURE_DISTANCE - 6)).toBe(false);
  });

  it('leaves mud, rain and sweat on a player', () => {
    const store = new Map<string, PlayerMarks>();
    const marks = newMarks(store, 'p', 12345);
    expect(store.get('p')).toBe(marks);
    // One slide stains once, however long it lasts; a second slide adds more. A wet pitch dirties more.
    for (let tick = 0; tick < 30; tick++) markPlayer(marks, 'slide', tick, 100, 'clear', 1 / 60);
    const once = marks.mud;
    expect(once).toBeGreaterThan(0.1);
    markPlayer(marks, 'jog', 0, 100, 'clear', 1 / 60);
    for (let tick = 0; tick < 30; tick++) markPlayer(marks, 'slide', tick, 100, 'clear', 1 / 60);
    expect(marks.mud).toBeCloseTo(once * 2, 5);
    const wetMarks = newMarks(store, 'q', 5);
    markPlayer(wetMarks, 'slide', 0, 100, 'rain', 1 / 60);
    expect(wetMarks.mud).toBeGreaterThan(once);
    for (let i = 0; i < 40; i++) { markPlayer(marks, 'jog', 0, 100, 'clear', 1 / 60); for (let tick = 0; tick < 3; tick++) markPlayer(marks, 'slide', tick, 100, 'storm', 1 / 60); }
    expect(marks.mud).toBe(1);
    // Rain soaks the shirt up to the limit of the weather; a dry day leaves it dry.
    const dry = newMarks(store, 'd', 7), soaked = newMarks(store, 's', 8);
    let redraws = 0;
    for (let second = 0; second < 300; second++) { markPlayer(dry, 'jog', 0, 100, 'clear', 1); if (markPlayer(soaked, 'jog', 0, 100, 'rain', 1)) redraws++; }
    expect(dry.wet).toBe(0);
    expect(soaked.wet).toBeCloseTo(soakLimit('rain'), 5);
    // The slow soaking is handed to the material in steps, not every frame.
    expect(redraws).toBeGreaterThan(20);
    expect(redraws).toBeLessThan(200);
    expect(soakLimit('storm')).toBeGreaterThan(soakLimit('rain'));
    // Sweat follows the stamina that is left.
    const fresh = newMarks(store, 'f', 9), tired = newMarks(store, 't', 10);
    for (let second = 0; second < 30; second++) { markPlayer(fresh, 'jog', 0, 96, 'clear', 1); markPlayer(tired, 'jog', 0, 35, 'clear', 1); }
    expect(fresh.sweat).toBe(0);
    expect(tired.sweat).toBeGreaterThan(0.8);
  });

  it('breathes visibly in the cold, faster when running', () => {
    const count = (speed: number) => {
      const marks = newMarks(new Map(), 'b', 77);
      let puffs = 0;
      for (let frame = 0; frame < 60 * 30; frame++) if (breathDue(marks, 1 / 60, speed)) puffs++;
      return puffs;
    };
    expect(count(0)).toBeGreaterThan(8);
    expect(count(0)).toBeLessThan(16);
    expect(count(7)).toBeGreaterThan(count(0) * 1.8);
  });
});
