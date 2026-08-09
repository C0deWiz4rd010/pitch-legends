import { computeOverall } from './core/ratings';
import { Rng } from './core/util';
import { createNewGame } from './data/generators';
import { MatchEngineService } from './core/services/match-engine.service';
import { buildProfile, LiveMatch } from './core/services/match-sim';
import { RpgService } from './core/services/rpg.service';
import { SAVE_VERSION } from './models/game.model';
import { ArcadeMatch } from './core/services/arcade-match';

describe('ratings', () => {
  it('computes a goalkeeper overall dominated by goalkeeping', () => {
    const attrs = {
      pace: 40,
      shooting: 20,
      passing: 55,
      dribbling: 40,
      defending: 45,
      physical: 60,
      stamina: 55,
      goalkeeping: 88,
    };
    const overall = computeOverall(attrs, 'GK');
    expect(overall).toBeGreaterThan(70);
    expect(overall).toBeLessThanOrEqual(99);
  });
});

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });
});

describe('match engine', () => {
  it('produces a deterministic, valid result for a given seed', () => {
    const game = createNewGame({ managerName: 'Test', clubName: 'Test FC', seed: 42 });
    const [home, away] = game.teams;
    const engine = new MatchEngineService();
    const r1 = engine.simulate(home, away, 1, 999);
    const r2 = engine.simulate(home, away, 1, 999);
    expect(r1.homeScore).toBe(r2.homeScore);
    expect(r1.awayScore).toBe(r2.awayScore);
    expect(r1.homeScore).toBeGreaterThanOrEqual(0);
    expect(r1.events.length).toBeGreaterThan(0);
    expect(r1.homeStats.possession + r1.awayStats.possession).toBe(100);
  });

  it('controls the selected club even when it is the away team', () => {
    const game = createNewGame({ managerName: 'Test', clubName: 'Test FC', seed: 77 });
    const home = game.teams[1];
    const away = game.teams[0];
    const originalHome = home.tactics.mentality;
    const live = new LiveMatch(home, away, 1, away.id, 123);

    live.setMentality('ultra-attacking');

    expect(live.controlled.id).toBe(away.id);
    expect(live.away.tactics.mentality).toBe('ultra-attacking');
    expect(live.home.tactics.mentality).toBe(originalHome);
  });

  it('maps build-up, width and player instructions into team strength', () => {
    const game = createNewGame({ managerName: 'Test', clubName: 'Test FC', seed: 11 });
    const team = structuredClone(game.teams[0]);
    const baseline = buildProfile(team, false);
    team.tactics.buildUp = 'play-out-of-defence';
    team.tactics.width = 'narrow';
    team.formation.slots.forEach((slot) => {
      slot.instruction.duty = 'attack';
      slot.instruction.forwardRuns = 'often';
    });
    const adjusted = buildProfile(team, false);

    expect(adjusted.midfield).toBeGreaterThan(baseline.midfield);
    expect(adjusted.attack).toBeGreaterThan(baseline.attack);
  });
});

describe('arcade match', () => {
  it('creates 22 actors and remains deterministic for the same seed and input', () => {
    const game = createNewGame({ managerName: 'Pixel', clubName: 'Arcade FC', seed: 51 });
    const [home, away] = game.teams;
    const first = new ArcadeMatch(home, away, home.id, 3, 2026);
    const second = new ArcadeMatch(home, away, home.id, 3, 2026);
    const input = { moveX: 1, moveY: 0, sprint: true, pass: false, through: false, shoot: false, switchPlayer: false };

    for (let frame = 0; frame < 900; frame++) {
      first.step(1 / 60, input);
      second.step(1 / 60, input);
    }

    expect(first.actors).toHaveLength(22);
    expect(first.ball).toEqual(second.ball);
    expect(first.actors.map(({ x, y, stamina }) => ({ x, y, stamina }))).toEqual(
      second.actors.map(({ x, y, stamina }) => ({ x, y, stamina })),
    );
  });

  it('assigns direct control to the player club when playing away', () => {
    const game = createNewGame({ managerName: 'Pixel', clubName: 'Arcade FC', seed: 52 });
    const match = new ArcadeMatch(game.teams[1], game.teams[0], game.teams[0].id, 3, 9);

    expect(match.controlledSide).toBe('away');
    expect(match.controlledTeam.id).toBe(game.teams[0].id);
    expect(match.actors.find((actor) => actor.player.id === match.selectedPlayerId)?.side).toBe('away');
  });
});

describe('v2 progression', () => {
  it('creates a fresh versioned career with manager and player RPG data', () => {
    const game = createNewGame({ managerName: 'Pixel', clubName: 'Arcade FC', seed: 2 });
    expect(game.version).toBe(SAVE_VERSION);
    expect(game.manager.level).toBe(1);
    expect(game.trainingWeek.maxSlots).toBe(3);
    expect(game.teams[0].players.every((player) => !!player.archetype && !!player.personalGoal)).toBe(true);
  });

  it('spends points on an archetype talent and applies its effective bonus', () => {
    const game = createNewGame({ managerName: 'Pixel', clubName: 'Arcade FC', seed: 3 });
    const player = game.teams[0].players[0];
    player.level = 10;
    player.skillPoints = 10;
    const service = new RpgService();
    const talent = service.availableTalents(player)[0];

    expect(service.unlockTalent(player, talent.id)).toBe(true);
    expect(player.talentRanks[talent.id]).toBe(1);
    expect(player.skillPoints).toBe(10 - talent.cost);
  });
});
