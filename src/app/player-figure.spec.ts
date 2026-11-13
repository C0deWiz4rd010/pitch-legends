import * as THREE from 'three';
import { createPlayerVisualIdentity } from './core/visual-identity';
import { createPracticeTeams } from './core/football/practice';
import { createProceduralFootballer } from './features/match/three-player.factory';
import { stackSurface } from './features/match/player-body';
import { createPlayerStyle, styleTraits } from './features/match/player-style';

const kit = createPracticeTeams().home.visuals.kits.home;

describe('Player style kit', () => {
  it('gives the same player the same look every time and a squad many different ones', () => {
    const identity = createPlayerVisualIdentity('style-spec');
    expect(createPlayerStyle(identity)).toEqual(createPlayerStyle({ ...identity }));
    const looks = new Set<string>();
    const frames = new Set<string>();
    let withTraits = 0;
    for (let seed = 0; seed < 128; seed++) {
      const style = createPlayerStyle(createPlayerVisualIdentity(`studio-${seed}`));
      looks.add(JSON.stringify(style));
      frames.add(style.frame);
      if (styleTraits(style).length) withTraits++;
    }
    // Traits combine freely: hardly two of 128 players wear exactly the same.
    expect(looks.size).toBeGreaterThan(110);
    expect(frames.size).toBe(4);
    expect(withTraits).toBeGreaterThan(80);
  });

  it('keeps rare items rare', () => {
    let goggles = 0, snoods = 0;
    for (let seed = 0; seed < 600; seed++) {
      const style = createPlayerStyle(createPlayerVisualIdentity(`rare-${seed}`));
      if (style.face === 'goggles') goggles++;
      if (style.snood) snoods++;
    }
    expect(goggles).toBeGreaterThan(0);
    expect(goggles).toBeLessThan(60);
    expect(snoods).toBeLessThan(70);
  });
});

describe('Player body surfaces', () => {
  it('builds a closed-looking skin that faces outwards whichever way the sections run', () => {
    for (const rings of [
      [{ y: 0, hw: 0.2, front: 0.1, back: 0.1, a: 0 }, { y: 0.5, hw: 0.1, front: 0.1, back: 0.1, a: 0 }],
      [{ y: 0.5, hw: 0.1, front: 0.1, back: 0.1, a: 0 }, { y: 0, hw: 0.2, front: 0.1, back: 0.1, a: 0 }],
    ]) {
      const geometry = stackSurface(rings, 8);
      const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
      for (let index = 0; index < position.count; index++) {
        const outward = new THREE.Vector3(position.getX(index), 0, position.getZ(index)).normalize();
        expect(outward.dot(new THREE.Vector3(normal.getX(index), 0, normal.getZ(index)).normalize())).toBeGreaterThan(0.3);
      }
    }
  });

  it('dresses every frame and style with finite, normalised skin weights', () => {
    for (let seed = 0; seed < 128; seed += 3) {
      const model = createProceduralFootballer(createPlayerVisualIdentity(`studio-${seed}`), kit, 9, seed % 11 === 0);
      const geometry = model.mesh.geometry;
      const position = geometry.getAttribute('position'), weight = geometry.getAttribute('skinWeight');
      let lowest = Infinity, highest = -Infinity;
      for (let index = 0; index < position.count; index++) {
        const y = position.getY(index);
        expect(Number.isFinite(position.getX(index) + y + position.getZ(index))).toBe(true);
        expect(weight.getX(index) + weight.getY(index)).toBeCloseTo(1, 4);
        lowest = Math.min(lowest, y); highest = Math.max(highest, y);
      }
      // The soles stand on the grass and the figure is as tall as its recipe says, give or take the hair.
      expect(lowest).toBeGreaterThan(-0.02);
      expect(lowest).toBeLessThan(0.06);
      expect(highest).toBeGreaterThan(model.recipe.height * 0.9);
      expect(highest).toBeLessThan(model.recipe.height * 1.12);
      model.destroy();
    }
  }, 60_000);
});
