import { Cond } from './core/rpg/conditions';
import { dnaForRarity } from './core/rpg/player-dna';
import { ULTIMATE_COST, ULTIMATE_SECONDS } from './core/rpg/signatures';
import { buildStatBlock, resolveHook } from './core/rpg/stat-block';
import { createPracticeTeams } from './core/football/practice';
import { ArcadeActor, MATCH_TICK } from './core/football/match-types';
import { ArcadeMatch } from './core/services/arcade-match';
import { CONTROL_BINDINGS, CONTROL_INPUT_MAP } from './data/control-bindings';
import { EMPTY_MATCH_COMMAND, MatchCommand, MatchConfig } from './models/match.model';
import { Player } from './models/player.model';
import { Team } from './models/team.model';

function config(controlledTeamId: string, extra: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mode: 'play', controllerMode: 'auto', controlledTeamId, halfMinutes: 3, seed: 8128, difficulty: 'normal', assist: 'balanced',
    playerLockId: null, weather: 'clear', inputDevice: 'ai', camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true }, ...extra,
  };
}

function makeMythic(team: Team): Player {
  const player = team.players.find((candidate) => candidate.positionGroup === 'ATT')!;
  player.dna = dnaForRarity(player, 'mythic');
  return player;
}

/** Steps until the kick-off has been taken and the ball is in play. */
function untilPlaying(match: ArcadeMatch, command?: MatchCommand): void {
  for (let tick = 0; tick < 600 && match.rule.phase !== 'playing'; tick++) match.step(MATCH_TICK, command);
}

interface Internals {
  addFocus(side: 'home' | 'away', amount: number): void;
  focus: Record<'home' | 'away', number>;
  ultimateUntil: Record<'home' | 'away', number>;
  ultimateUser: Record<'home' | 'away', string | null>;
  triggerUltimate(side: 'home' | 'away'): boolean;
  canTriggerUltimate(side: 'home' | 'away'): boolean;
  hasUltimate(side: 'home' | 'away'): boolean;
}

describe('Mythic ultimate', () => {
  function setup(extra: Partial<MatchConfig> = {}) {
    const { home, away } = createPracticeTeams(111);
    const mythic = makeMythic(home);
    const match = new ArcadeMatch(home, away, config(home.id, extra));
    const actor = match.actors.find((candidate) => candidate.player.id === mythic.id)!;
    return { match, actor, internals: match as unknown as Internals, home, away };
  }

  it('gives only Mythic players the ultimate bonus in their stat block', () => {
    const { home } = createPracticeTeams(112);
    const mythic = makeMythic(home);
    const common = structuredClone(mythic);
    common.dna = dnaForRarity(common, 'epic');
    expect(resolveHook(buildStatBlock(mythic), 'passError', 1, Cond.ultimate | Cond.signature | Cond.signature2)).toBeLessThan(resolveHook(buildStatBlock(common), 'passError', 1, Cond.signature | Cond.signature2));
    expect(resolveHook(buildStatBlock(common), 'passError', 1, Cond.ultimate)).toBe(1);
  });

  it('fills the meter only for a side with a Mythic player, capped at 100', () => {
    const { internals } = setup();
    expect(internals.hasUltimate('home')).toBe(true);
    expect(internals.hasUltimate('away')).toBe(false);
    internals.addFocus('away', 50);
    expect(internals.focus.away).toBe(0);
    internals.addFocus('home', 60);
    internals.addFocus('home', 60);
    expect(internals.focus.home).toBe(ULTIMATE_COST);
  });

  it('needs a full meter, runs both signatures with the bonus for six seconds and empties the meter', () => {
    const { match, actor, internals } = setup();
    untilPlaying(match);
    expect(internals.triggerUltimate('home')).toBe(false);
    internals.addFocus('home', 100);
    expect(internals.canTriggerUltimate('home')).toBe(true);
    expect(internals.triggerUltimate('home')).toBe(true);
    expect(internals.focus.home).toBe(0);
    expect(internals.canTriggerUltimate('home')).toBe(false);
    expect(match.events.some((event) => event.messageKey === 'match.ultimate' && event.playerId === actor.player.id)).toBe(true);
    for (let tick = 0; tick < 12; tick++) match.step(MATCH_TICK);
    expect((actor.flags ?? 0) & Cond.ultimate).toBeTruthy();
    expect((actor.flags ?? 0) & Cond.signature).toBeTruthy();
    expect((actor.flags ?? 0) & Cond.signature2).toBeTruthy();
    for (let tick = 0; tick < ULTIMATE_SECONDS * 60 + 12; tick++) match.step(MATCH_TICK);
    expect((actor.flags ?? 0) & Cond.ultimate).toBeFalsy();
  });

  it('fires from the command of a human player, on the rising edge only', () => {
    const { match, internals } = setup({ controllerMode: 'human', mode: 'play' });
    const idle: MatchCommand = { ...EMPTY_MATCH_COMMAND };
    untilPlaying(match, idle);
    for (let tick = 0; tick < 20; tick++) match.step(MATCH_TICK, idle);
    internals.addFocus('home', 100);
    match.step(MATCH_TICK, { ...idle, ultimate: true });
    expect(internals.focus.home).toBe(0);
    expect(internals.ultimateUntil.home).toBeGreaterThan(0);
    const until = internals.ultimateUntil.home;
    internals.addFocus('home', 100);
    match.step(MATCH_TICK, { ...idle, ultimate: true });
    expect(internals.ultimateUntil.home).toBe(until);
    expect(internals.focus.home).toBeGreaterThan(90);
  });

  it('lets the AI use it and reports it, in a full simulated match', () => {
    let uses = 0;
    for (let index = 0; index < 6; index++) {
      const { home, away } = createPracticeTeams(120 + index);
      makeMythic(home);
      makeMythic(away);
      const result = new ArcadeMatch(home, away, config(home.id, { mode: 'instant', seed: 400 + index })).result();
      uses += (result.signatures ?? []).filter((entry) => entry.signatureId === 'ultimate').reduce((sum, entry) => sum + entry.activations, 0);
    }
    expect(uses).toBeGreaterThan(0);
  }, 120_000);

  it('survives a checkpoint with the meter and a running ultimate', () => {
    const { match, internals, home, away } = setup();
    internals.addFocus('home', 100);
    internals.triggerUltimate('home');
    internals.addFocus('home', 30);
    for (let tick = 0; tick < 30; tick++) match.step(MATCH_TICK);
    const checkpoint = match.checkpoint();
    const resumed = new ArcadeMatch(home, away, config(home.id));
    expect(resumed.restore(checkpoint)).toBe(true);
    const copy = resumed as unknown as Internals;
    expect(copy.focus.home).toBeCloseTo(internals.focus.home, 5);
    expect(copy.ultimateUntil.home).toBe(internals.ultimateUntil.home);
    expect(copy.ultimateUser.home).toBe(internals.ultimateUser.home);
    const first = resumed.actors.find((actor: ArcadeActor) => actor.player.id === copy.ultimateUser.home)!;
    expect(first.sig?.length).toBe(2);
  });

  it('is bindable and documented', () => {
    expect(CONTROL_INPUT_MAP.ultimate).toEqual({ keyboard: ['KeyF'], gamepadButton: 8 });
    expect(CONTROL_BINDINGS.some((binding) => binding.action === 'ultimate')).toBe(true);
    expect(EMPTY_MATCH_COMMAND.ultimate).toBe(false);
  });
});
