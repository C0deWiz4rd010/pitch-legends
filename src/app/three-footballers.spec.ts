import { createAppearanceRecipe, createProceduralFootballer, poseFootballer, solveLeg } from './features/match/three-player.factory';
import { createPlayerVisualIdentity, createClubVisualIdentity } from './core/visual-identity';
import { createPracticeTeams } from './core/football/practice';
import { ArcadeMatch } from './core/services/arcade-match';
import { interpolateFacing, interpolateThreeFrame } from './features/match/three-render-state';

describe('procedural three-dimensional footballers', () => {
  const kit = createClubVisualIdentity('Test','TST','#18bb99','#102844',3).kits.home;
  it('preserves 128 seeded identities and bounded human proportions', () => {
    const recipes = Array.from({ length: 128 }, (_, i) => createAppearanceRecipe(createPlayerVisualIdentity(`player-${i}`)));
    expect(new Set(recipes.map(recipe => recipe.seed)).size).toBe(128);
    for (const recipe of recipes) {
      expect(createAppearanceRecipe(recipe.identity)).toEqual(recipe);
      expect(recipe.height).toBeGreaterThanOrEqual(1.69);
      expect(recipe.height).toBeLessThan(1.95);
    }
  });
  it('builds a single finite skinned mesh and reuses the identity in different kits', () => {
    const identity = createPlayerVisualIdentity('captain');
    const model = createProceduralFootballer(identity, kit, 10);
    expect(model.mesh.isSkinnedMesh).toBe(true);
    expect(model.mesh.geometry.groups).toHaveLength(0);
    expect(model.mesh.skeleton.bones.length).toBeGreaterThanOrEqual(16);
    expect([...model.mesh.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);
    const changed = createProceduralFootballer(identity, { ...kit, shirt: '#dd4433' }, 10);
    expect(changed.recipe).toEqual(model.recipe);
    expect(changed.mesh.geometry.getAttribute('color').array).not.toEqual(model.mesh.geometry.getAttribute('color').array);
    model.destroy(); changed.destroy();
  });
  it('animates a running skeleton without changing simulation state', () => {
    const teams = createPracticeTeams();
    const match = new ArcadeMatch(teams.home, teams.away, teams.home.id);
    const runtime = match.renderState().players[1];
    const before = structuredClone(runtime);
    const model = createProceduralFootballer(teams.home.players[0].visuals, kit);
    poseFootballer(model, { ...runtime, vx: 7, animationDistance: 1, action: 'sprint' }, 60, 1);
    const angle = model.joints.leftThigh.rotation.x;
    poseFootballer(model, { ...runtime, vx: 7, animationDistance: 2, action: 'sprint' }, 61, 1.016);
    expect(model.joints.leftThigh.rotation.x).not.toBe(angle);
    expect(runtime).toEqual(before);
    model.destroy();
  });
  it('interpolates exact opposite headings without shrinking to a zero vector', () => {
    const facing = interpolateFacing(1,0,-1,0,.5);
    expect(Math.hypot(facing.x,facing.y)).toBeCloseTo(1);
    expect(Math.abs(facing.y)).toBeCloseTo(1);
  });
  it('keeps two-link leg solutions finite for unreachable targets', () => {
    for (const target of [[0,0],[10,0],[0,.8],[-.5,.5]]) {
      expect(Object.values(solveLeg(.42,.40,...target as [number,number])).every(Number.isFinite)).toBe(true);
    }
  });
});
