import { shootoutConversionChance } from './core/football/penalty';
import { shotAngleQuality, shotXg } from './core/football/xg';
import { createPracticeTeams } from './core/football/practice';
import { MatchEngineService } from './core/services/match-engine.service';
import { generatePersonName } from './data/world-generator';

describe('Phase 0 foundation fixes', () => {
  it('scales the shot angle falloff with the pitch width', () => {
    expect(shotAngleQuality(15.5, 68)).toBeCloseTo(0.5, 5);
    expect(shotAngleQuality(6.5, 28)).toBeCloseTo(0.5, 1);
    expect(shotAngleQuality(0, 28)).toBe(1);
    // A cage shot from the edge is as bad as a full-pitch shot from the touchline.
    expect(shotAngleQuality(14, 28)).toBe(shotAngleQuality(34, 68));
    expect(shotXg(8, 0, 70, 0, false, 28)).toBeGreaterThan(shotXg(8, 12, 70, 0, false, 28));
  });

  it('shares one shoot-out formula and keeps it inside its bounds', () => {
    expect(shootoutConversionChance(70, 70)).toBeCloseTo(0.76, 5);
    expect(shootoutConversionChance(70, 70, 0.05)).toBeCloseTo(0.81, 5);
    expect(shootoutConversionChance(99, 20)).toBe(0.92);
    expect(shootoutConversionChance(10, 99)).toBe(0.55);
  });

  it('generates person names deterministically with cached Faker instances', () => {
    const first = [1, 2, 3, 4].map((key) => generatePersonName(77, key));
    generatePersonName(5, 'interleaved');
    const second = [1, 2, 3, 4].map((key) => generatePersonName(77, key));
    expect(second).toEqual(first);
  });

  it('simulates identically on the cooperative (worker fallback) path and the synchronous path', async () => {
    const engine = new MatchEngineService();
    const { home, away } = createPracticeTeams(41);
    const perk = { teamId: away.id, tacticsRank: 3 };
    const sync = engine.simulate(structuredClone(home), structuredClone(away), 4, 9001, 'phase0-parity', false, perk);
    const async = await engine.simulateAsync(structuredClone(home), structuredClone(away), 4, 9001, 'phase0-parity', false, false, perk);
    expect({ ...async, id: undefined }).toEqual({ ...sync, id: undefined });
  }, 60_000);
});
