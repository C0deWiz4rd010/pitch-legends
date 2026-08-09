import {
  contrastRatio,
  createClubVisualIdentity,
  createPlayerVisualIdentity,
  crestSignature,
  ensureGameVisuals,
  playerVisualSignature,
} from './core/visual-identity';
import { createNewGame } from './data/generators';
import { SAVE_VERSION } from './models/game.model';

describe('procedural visual identities', () => {
  it('creates byte-identical club and player descriptions for an identical seed', () => {
    const firstClub = createClubVisualIdentity('Solaris FC', 'SOL', '#f0b429', '#111827', 42001);
    const secondClub = createClubVisualIdentity('Solaris FC', 'SOL', '#f0b429', '#111827', 42001);
    const firstPlayer = createPlayerVisualIdentity('player-stable');
    const secondPlayer = createPlayerVisualIdentity('player-stable');

    expect(JSON.stringify(firstClub)).toBe(JSON.stringify(secondClub));
    expect(JSON.stringify(firstPlayer)).toBe(JSON.stringify(secondPlayer));
  });

  it('gives every league club and every player in a squad a distinct signature', () => {
    const game = createNewGame({ managerName: 'Pixel', clubName: 'Pixel Athletic', seed: 9944 });
    const crests = game.teams.map((team) => crestSignature(team.visuals.crest));

    expect(new Set(crests).size).toBe(game.teams.length);
    for (const team of game.teams) {
      const players = team.players.map((player) => playerVisualSignature(player.visuals));
      expect(new Set(players).size).toBe(players.length);
    }
  });

  it('creates visibly separated outfield, away, and goalkeeper kits', () => {
    const visual = createClubVisualIdentity('Frostgate United', 'FGU', '#cbd5e1', '#172554', 77);

    expect(contrastRatio(visual.kits.home.shirt, visual.kits.away.shirt)).toBeGreaterThanOrEqual(3);
    expect(visual.kits.away.pattern).not.toBe('solid');
    expect(visual.kits.goalkeeper.shirt).not.toBe(visual.kits.home.shirt);
    expect(visual.kits.goalkeeper.shirt).not.toBe(visual.kits.away.shirt);
  });

  it('migrates an incomplete V2-shaped state without mutating its source', () => {
    const source = createNewGame({ managerName: 'Legacy', clubName: 'Legacy Town', seed: 7744 }) as any;
    source.version = 2;
    delete source.teams[0].visuals;
    delete source.teams[0].players[0].visuals;
    delete source.settings.controlLearning;

    const migratedA = ensureGameVisuals(source);
    const migratedB = ensureGameVisuals(source);

    expect(source.version).toBe(2);
    expect(source.teams[0].visuals).toBeUndefined();
    expect(migratedA.version).toBe(SAVE_VERSION);
    expect(migratedA.teams[0].visuals).toEqual(migratedB.teams[0].visuals);
    expect(migratedA.teams[0].players[0].visuals).toEqual(migratedB.teams[0].players[0].visuals);
  });
});
