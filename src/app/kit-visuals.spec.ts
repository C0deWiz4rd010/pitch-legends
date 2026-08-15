import { createNewGame } from './data/generators';
import { createPixelRamp, kitSeparationScore, kitVisualSignature, resolveMatchKits } from './core/kit-visuals';

describe('V3 kit visuals', () => {
  it('builds deterministic four-tone ramps for arbitrary club colours', () => {
    expect(createPixelRamp('#e11d48')).toEqual(createPixelRamp('#e11d48'));
    expect(createPixelRamp('#e11d48')).not.toEqual(createPixelRamp('#2563eb'));
    expect(Object.values(createPixelRamp('#050505')).every((colour) => /^#[0-9a-f]{6}$/i.test(colour))).toBe(true);
  });

  it('selects readable fixture and goalkeeper kits without mutating clubs', () => {
    const game = createNewGame({ managerName: 'Kit', clubName: 'Colour City', seed: 15001 });
    const [home, away] = game.teams;
    const before = JSON.stringify([home.visuals.kits, away.visuals.kits]);
    const selection = resolveMatchKits(home, away);

    expect(kitSeparationScore(selection.home, selection.away)).toBeGreaterThanOrEqual(7);
    expect(kitSeparationScore(selection.home, selection.homeGoalkeeper)).toBeGreaterThanOrEqual(6);
    expect(kitSeparationScore(selection.away, selection.awayGoalkeeper)).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify([home.visuals.kits, away.visuals.kits])).toBe(before);
  });

  it('keeps kit signatures sensitive to every visible design field', () => {
    const game = createNewGame({ managerName: 'Kit', clubName: 'Pattern FC', seed: 15002 });
    const kit = game.teams[0].visuals.kits.home;
    expect(kitVisualSignature(kit)).not.toBe(kitVisualSignature({ ...kit, pattern: kit.pattern === 'solid' ? 'stripes' : 'solid' }));
    expect(kitVisualSignature(kit)).not.toBe(kitVisualSignature({ ...kit, number: kit.number === '#ffffff' ? '#000000' : '#ffffff' }));
  });
});
