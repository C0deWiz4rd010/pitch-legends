import { ArcadeMatch } from './core/services/arcade-match';
import { CHALLENGES, ChallengeController, medalFor } from './core/football/challenges';
import { FIELD_LENGTH, FIELD_WIDTH, MATCH_TICK, PITCH, SMALL_PITCH } from './core/football/match-types';
import { createPracticeTeams } from './core/football/practice';
import { quickClubs, quickTeam, DEFAULT_QUICK_SETTINGS } from './core/football/quick-match';
import { smallSidedTeam } from './core/football/small-sided';
import { createLegendsState, ownTeam, rivalsOpponent } from './core/legends/legends-engine';
import { MatchConfig } from './models/match.model';

function config(controlledTeamId: string, extra: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mode: 'instant', controllerMode: 'auto', controlledTeamId, halfMinutes: 3, seed: 515, difficulty: 'normal', assist: 'balanced',
    playerLockId: null, weather: 'clear', inputDevice: 'ai', camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true }, ...extra,
  };
}

describe('Game modes: five-a-side, challenges, quick match', () => {
  it('plays five-a-side in the cage: five players a side, boards instead of throw-ins, no offside', () => {
    const { home, away } = createPracticeTeams(31);
    const match = new ArcadeMatch(smallSidedTeam(home), smallSidedTeam(away), config(home.id, { smallSided: true }));
    expect(PITCH).toBe(SMALL_PITCH);
    expect(match.actors.filter((actor) => actor.side === 'home')).toHaveLength(5);
    let maxX = 0, maxY = 0;
    for (let tick = 0; tick < 60 * 60 && !match.finished; tick++) {
      if (match.phase === 'halftime') match.resumeSecondHalf();
      if (match.phase === 'goalReplay') match.endReplay();
      match.step(MATCH_TICK);
      for (const actor of match.actors) if (actor.active) { maxX = Math.max(maxX, actor.x); maxY = Math.max(maxY, actor.y); }
    }
    expect(maxX).toBeLessThanOrEqual(SMALL_PITCH.length);
    expect(maxY).toBeLessThanOrEqual(SMALL_PITCH.width);
    expect(match.events.some((event) => event.messageKey === 'match.throwIn')).toBe(false);
    expect(match.events.some((event) => event.messageKey?.includes('offside'))).toBe(false);
    expect(match.homeStats.passesAttempted).toBeGreaterThan(5);
  }, 30_000);

  it('switches back to the full pitch for the next normal match', () => {
    const { home, away } = createPracticeTeams(32);
    new ArcadeMatch(smallSidedTeam(home), smallSidedTeam(away), config(home.id, { smallSided: true }));
    expect(FIELD_LENGTH).toBe(SMALL_PITCH.length);
    const full = new ArcadeMatch(home, away, config(home.id));
    expect(FIELD_LENGTH).toBe(105);
    expect(FIELD_WIDTH).toBe(68);
    expect(full.actors.filter((actor) => actor.side === 'home')).toHaveLength(11);
  });

  it('awards medals on both scales', () => {
    const finishing = CHALLENGES.find((challenge) => challenge.id === 'finishing')!;
    const slalom = CHALLENGES.find((challenge) => challenge.id === 'slalom')!;
    expect(medalFor(finishing, 7)).toBe('gold');
    expect(medalFor(finishing, 4)).toBe('bronze');
    expect(medalFor(finishing, 1)).toBeNull();
    expect(medalFor(slalom, 13.2)).toBe('gold');
    expect(medalFor(slalom, 30)).toBeNull();
  });

  for (const id of ['finishing', 'passing', 'slalom', 'penalty', 'freekick'] as const) {
    it(`runs the ${id} challenge to an end on its fixed seed`, () => {
      const definition = CHALLENGES.find((challenge) => challenge.id === id)!;
      const { home, away } = createPracticeTeams(definition.seed);
      const match = new ArcadeMatch(home, away, config(home.id, { mode: 'play', controllerMode: id === 'penalty' || id === 'freekick' ? 'auto' : 'human', halfMinutes: 8, seed: definition.seed }));
      const controller = new ChallengeController(definition, match);
      controller.start();
      expect(match.actors.filter((actor) => actor.active).length).toBeLessThanOrEqual(6);
      for (let tick = 0; tick < 60 * 120 && !controller.done; tick++) {
        match.step(MATCH_TICK);
        controller.afterStep();
      }
      expect(controller.done).toBe(true);
      const outcome = controller.outcome();
      expect(outcome.id).toBe(id);
      expect(Number.isFinite(outcome.score)).toBe(true);
    }, 30_000);
  }

  it('builds quick-match clubs that can meet themselves', () => {
    expect(quickClubs()).toHaveLength(12);
    expect(new Set(quickClubs().map((club) => club.short)).size).toBe(12);
    const home = quickTeam(3, DEFAULT_QUICK_SETTINGS, true);
    const away = quickTeam(3, DEFAULT_QUICK_SETTINGS, false);
    const ids = [...home.players, ...away.players].map((player) => player.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(away.formation.slots.every((slot) => !slot.playerId || away.players.some((player) => player.id === slot.playerId))).toBe(true);
  });

  it('plays a full Legends Rivals match with the card squad', () => {
    const state = createLegendsState('Engine XI', 99);
    const home = ownTeam(state), away = rivalsOpponent(state);
    const match = new ArcadeMatch(home, away, config(home.id));
    match.simulateToEnd();
    const result = match.result();
    expect(result.homeScore).toBeGreaterThanOrEqual(0);
    expect(match.actors.filter((actor) => actor.side === 'home')).toHaveLength(11);
  }, 30_000);
});
