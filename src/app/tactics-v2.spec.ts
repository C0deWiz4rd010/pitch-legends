import { createNewGame } from './data/generators';
import {
  analyzeTactics,
  applyTacticPreset,
  detectTacticPreset,
  rankSetPieceTakers,
  TACTIC_PRESETS,
} from './core/tactics-analysis';

describe('Tactical command workspace', () => {
  it('applies every preset exactly and detects manual deviations as custom', () => {
    const game = createNewGame({ managerName: 'Tactics', clubName: 'Tactics FC', seed: 1601 });
    const club = game.teams.find((team) => team.id === game.clubId)!;
    for (const id of Object.keys(TACTIC_PRESETS) as (keyof typeof TACTIC_PRESETS)[]) {
      club.tactics = applyTacticPreset(club.tactics, id);
      expect(detectTacticPreset(club.tactics)).toBe(id);
      expect(club.tactics).toMatchObject(TACTIC_PRESETS[id]);
    }
    club.tactics.tempo = club.tactics.tempo === 'fast' ? 'slow' : 'fast';
    expect(detectTacticPreset(club.tactics)).toBe('custom');
  });

  it('produces deterministic analysis values from the shared match profile', () => {
    const game = createNewGame({ managerName: 'Analyst', clubName: 'Analyst FC', seed: 1602 });
    const club = game.teams.find((team) => team.id === game.clubId)!;
    const first = analyzeTactics(club);
    const second = analyzeTactics(structuredClone(club));
    expect(first).toEqual(second);
    for (const value of [first.attack, first.control, first.defence, first.transition, first.fitnessLoad, first.risk]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('warns about a high line when the selected defenders are too slow', () => {
    const game = createNewGame({ managerName: 'Warning', clubName: 'Warning FC', seed: 1603 });
    const club = game.teams.find((team) => team.id === game.clubId)!;
    club.tactics.defensiveLine = 'high';
    for (const slot of club.formation.slots) {
      const player = club.players.find((candidate) => candidate.id === slot.playerId);
      if (player?.positionGroup === 'DEF') player.attributes.pace = 40;
    }
    expect(analyzeTactics(club).warnings.some((warning) => warning.id === 'slow-line')).toBe(true);
  });

  it('ranks set-piece takers by the documented relevant attributes', () => {
    const game = createNewGame({ managerName: 'Set Piece', clubName: 'Set Piece FC', seed: 1604 });
    const club = game.teams.find((team) => team.id === game.clubId)!;
    const players = club.players.slice(0, 3);
    players[0].attributes.shooting = 99;
    players[1].attributes.shooting = 60;
    players[2].attributes.shooting = 40;
    players[1].attributes.passing = 99;
    expect(rankSetPieceTakers(players, 'penalty')[0].id).toBe(players[0].id);
    expect(rankSetPieceTakers(players, 'corner')[0].id).toBe(players[1].id);
  });
});
