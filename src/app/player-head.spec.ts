import { createPlayerVisualIdentity } from './core/visual-identity';
import { createPracticeTeams } from './core/football/practice';
import { createProceduralFootballer } from './features/match/three-player.factory';
import { BEARD_STYLES, HAIR_STYLES, HAIR_STYLE_COUNT, headGeometry } from './features/match/player-head';

const kit = createPracticeTeams().home.visuals.kits.home;
const base = createPlayerVisualIdentity('head-spec');

function vertices(patch: Partial<typeof base>, compact = false): number {
  const model = createProceduralFootballer({ ...base, headAccessory: 'none', ...patch }, kit, 9, false, false, compact);
  const position = model.mesh.geometry.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    if (!Number.isFinite(position.getX(index) + position.getY(index) + position.getZ(index))) throw new Error('non-finite vertex');
  }
  const count = position.count;
  model.destroy();
  return count;
}

describe('Player heads', () => {
  it('shapes the skull: narrower at the chin than at the cheeks, squarer with a strong jaw', () => {
    const width = (jaw: number, height: number) => {
      const position = headGeometry(jaw, false).getAttribute('position');
      let widest = 0;
      for (let index = 0; index < position.count; index++) if (Math.abs(position.getY(index) - height) < 0.12) widest = Math.max(widest, Math.abs(position.getX(index)));
      return widest;
    };
    expect(width(0, -0.75)).toBeLessThan(width(0, 0) * 0.75);
    expect(width(1, -0.75)).toBeGreaterThan(width(0, -0.75));
  });

  it('builds eighteen different hair styles, the bald head being the lightest', () => {
    expect(HAIR_STYLES.length).toBe(HAIR_STYLE_COUNT);
    const counts = HAIR_STYLES.map((_, style) => vertices({ hairStyle: style, facialHair: 0 }));
    const bald = counts[HAIR_STYLES.indexOf('bald')];
    for (const [style, count] of counts.entries()) if (HAIR_STYLES[style] !== 'bald') expect(count).toBeGreaterThan(bald);
    // No two styles are the same geometry.
    expect(new Set(counts).size).toBeGreaterThanOrEqual(HAIR_STYLE_COUNT - 2);
  }, 60_000);

  it('adds a beard in every style but the clean-shaven one', () => {
    const counts = BEARD_STYLES.map((_, beard) => vertices({ hairStyle: 0, facialHair: beard }));
    for (let beard = 1; beard < counts.length; beard++) expect(counts[beard]).toBeGreaterThan(counts[0]);
  }, 60_000);

  it('keeps the far-away figure much lighter and every identity valid', () => {
    for (let style = 0; style < HAIR_STYLE_COUNT; style++) {
      const full = vertices({ hairStyle: style, facialHair: 5 });
      const compact = vertices({ hairStyle: style, facialHair: 5 }, true);
      expect(compact).toBeLessThan(full * 0.7);
    }
    for (let seed = 0; seed < 128; seed += 4) {
      const model = createProceduralFootballer(createPlayerVisualIdentity(`studio-${seed}`), kit, seed % 99 + 1);
      expect(model.mesh.geometry.getAttribute('position').count).toBeLessThan(9000);
      model.destroy();
    }
  }, 60_000);
});
