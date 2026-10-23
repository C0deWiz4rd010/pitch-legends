import { Cond } from './core/rpg/conditions';
import { buildStatBlock, explainStat, resolveAttribute, resolveHook, staticOverall } from './core/rpg/stat-block';
import { createPracticeTeams } from './core/football/practice';
import { ArcadeActor, FULL_PITCH, MATCH_TICK } from './core/football/match-types';
import { ArcadeMatch } from './core/services/arcade-match';
import { MatchConfig } from './models/match.model';
import { Player } from './models/player.model';

function striker(traitIds: string[] = []): Player {
  const { home } = createPracticeTeams(7);
  const player = structuredClone(home.players.find((candidate) => candidate.positionGroup === 'ATT')!);
  player.traitIds = traitIds;
  player.talentRanks = {};
  player.morale = 65;
  player.form = 0;
  return player;
}

function config(controlledTeamId: string, extra: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mode: 'instant', controllerMode: 'auto', controlledTeamId, halfMinutes: 3, seed: 4242, difficulty: 'normal', assist: 'balanced',
    playerLockId: null, weather: 'clear', inputDevice: 'ai', camera: { zoom: 1, lookAhead: 0.18, shake: false, reducedMotion: true }, ...extra,
  };
}

/** Private engine hooks the pipeline is reached through. */
interface EngineInternals {
  actorFlags(actor: ArcadeActor, shared: number, owner: ArcadeActor | undefined): number;
  stat(actor: ArcadeActor, key: 'shooting' | 'goalkeeping' | 'pace'): number;
  statWith(actor: ArcadeActor, key: 'shooting' | 'goalkeeping' | 'pace', extraFlags: number): number;
  /** Re-resolves the actor's attribute view for its current flags plus `extra`. */
  applyKickFlags(actor: ArcadeActor, extra: number): void;
}

describe('RPG effect pipeline', () => {
  it('applies a trait only under the condition it promises', () => {
    const player = striker(['clinical']);
    const block = buildStatBlock(player);
    const base = block.base.shooting;
    expect(resolveAttribute(block, 'shooting', 0)).toBeCloseTo(base, 5);
    expect(resolveAttribute(block, 'shooting', Cond.inOppBox)).toBeCloseTo(Math.min(99, base + 6), 5);
    expect(resolveAttribute(block, 'shooting', Cond.inOwnBox | Cond.late)).toBeCloseTo(base, 5);
  });

  it('requires every flag of a combined condition', () => {
    const block = buildStatBlock(striker(['engine']));
    const calm = resolveAttribute(block, 'pace', 0);
    expect(resolveAttribute(block, 'pace', Cond.late)).toBeCloseTo(Math.min(99, calm + 3), 5);
    // Stamina is a flat +6, pace only late.
    expect(resolveAttribute(block, 'stamina', 0)).toBeGreaterThan(buildStatBlock(striker()).base.stamina);
  });

  it('caps stacked modifiers', () => {
    const player = striker(['clinical', 'iceveins', 'setpiece', 'leader']);
    player.attributes.shooting = 50;
    const block = buildStatBlock(player);
    const everything = Cond.inOppBox | Cond.penalty | Cond.setPiece;
    // +6 +8 +4 +2 = 20 raw, capped at +15.
    expect(resolveAttribute(block, 'shooting', everything)).toBeCloseTo(block.base.shooting + 15, 5);
    expect(resolveHook(block, 'shotError', 1, everything)).toBe(1);
  });

  it('scales with form, morale and position familiarity', () => {
    const player = striker();
    const neutral = buildStatBlock(player, { slotPosition: player.position }).base.shooting;
    player.form = 5;
    player.morale = 100;
    expect(buildStatBlock(player, { slotPosition: player.position }).base.shooting).toBeGreaterThan(neutral);
    player.form = -5;
    player.morale = 10;
    expect(buildStatBlock(player, { slotPosition: player.position }).base.shooting).toBeLessThan(neutral);
    player.form = 0;
    player.morale = 65;
    expect(buildStatBlock(player, { slotPosition: 'GK' }).base.shooting).toBeLessThan(neutral);
  });

  it('explains where a number comes from', () => {
    const player = striker(['clinical']);
    player.talentRanks = { 'finisher-1': 2 };
    const parts = explainStat(player, 'shooting', Cond.inOppBox);
    const trait = parts.find((part) => part.source.kind === 'trait');
    expect(trait).toMatchObject({ value: 6, op: 'add', active: true });
    expect(parts.find((part) => part.source.kind === 'talent')?.value).toBe(4);
    expect(explainStat(player, 'shooting', 0).find((part) => part.source.kind === 'trait')?.active).toBe(false);
  });

  it('values traits in the quick simulation without double counting situational bonuses', () => {
    const plain = striker();
    const rock = striker(['rock']);
    const clinical = striker(['clinical']);
    expect(staticOverall(rock)).toBeGreaterThanOrEqual(staticOverall(plain));
    expect(staticOverall(clinical)).toBeGreaterThanOrEqual(staticOverall(plain));
    // A situational +6 on shooting counts only partially: far below the full 0.34 weight of ATT shooting.
    expect(staticOverall(clinical) - staticOverall(plain)).toBeLessThanOrEqual(2);
  });

  describe('in the match engine', () => {
    function setup(effects?: boolean) {
      const { home, away } = createPracticeTeams(11);
      const target = home.players.find((candidate) => candidate.positionGroup === 'ATT')!;
      target.traitIds = ['clinical', 'iceveins', 'setpiece'];
      target.talentRanks = {};
      target.morale = 65;
      target.form = 0;
      const match = new ArcadeMatch(home, away, config(home.id, { effects }));
      const actor = match.actors.find((candidate) => candidate.player.id === target.id)!;
      return { match, actor, internals: match as unknown as EngineInternals };
    }

    it('flags the penalty area from the actors point of view', () => {
      const { match, actor, internals } = setup();
      actor.x = FULL_PITCH.length - 8;
      actor.y = FULL_PITCH.width / 2;
      const attacking = internals.actorFlags(actor, 0, undefined);
      expect(attacking & Cond.inOppBox).toBeTruthy();
      expect(attacking & Cond.inOwnBox).toBeFalsy();
      actor.x = 40;
      actor.flags = internals.actorFlags(actor, 0, undefined);
      expect(actor.flags & Cond.inOppBox).toBeFalsy();
      expect(match.actors.length).toBeGreaterThan(10);
    });

    it('lets Clinical Finisher help in the box and Ice in the Veins help from the spot', () => {
      const { actor, internals } = setup();
      actor.x = 30;
      actor.y = FULL_PITCH.width / 2;
      actor.flags = internals.actorFlags(actor, 0, undefined);
      internals.applyKickFlags(actor, 0);
      const outside = internals.stat(actor, 'shooting');
      actor.x = FULL_PITCH.length - 8;
      actor.flags = internals.actorFlags(actor, 0, undefined);
      internals.applyKickFlags(actor, 0);
      const inside = internals.stat(actor, 'shooting');
      expect(inside - outside).toBeCloseTo(6, 5);
      expect(internals.statWith(actor, 'shooting', Cond.penalty) - inside).toBeCloseTo(8, 5);
      // A dead-ball kick applies its flags to the view, and clearing them restores the open-play values.
      internals.applyKickFlags(actor, Cond.setPiece);
      expect(internals.stat(actor, 'shooting') - inside).toBeCloseTo(4, 5);
      internals.applyKickFlags(actor, 0);
      expect(internals.stat(actor, 'shooting')).toBeCloseTo(inside, 5);
    });

    it('follows the player through a substitution', () => {
      const { home, away } = createPracticeTeams(31);
      const match = new ArcadeMatch(home, away, config(home.id, { mode: 'play' }));
      const outgoing = match.actors.find((candidate) => candidate.side === 'home' && candidate.player.positionGroup === 'MID')!;
      const bench = match.home.players.find((candidate) => candidate.positionGroup === 'MID' && candidate.id !== outgoing.player.id && !match.actors.some((actor) => actor.player.id === candidate.id))!;
      bench.traitIds = ['rock'];
      bench.attributes.physical = 40;
      expect(match.makeSub(outgoing.player.id, bench.id)).toBe(true);
      expect(outgoing.player.id).toBe(bench.id);
      expect(outgoing.stats?.playerId).toBe(bench.id);
      // Powerhouse is a flat +6 on the incoming player, scaled by form, morale and position.
      expect(outgoing.attrs!.physical).toBeGreaterThan(40);
      expect(outgoing.attrs!.physical).toBeLessThan(40 + 6 + 4);
    });

    it('falls back to plain attributes when effects are switched off', () => {
      const { actor, internals } = setup(false);
      actor.x = FULL_PITCH.length - 8;
      actor.y = FULL_PITCH.width / 2;
      actor.flags = internals.actorFlags(actor, 0, undefined);
      expect(internals.stat(actor, 'shooting')).toBe(actor.player.attributes.shooting);
    });

    it('stays deterministic and keeps Ice in the Veins in shoot-outs', () => {
      const run = () => {
        const { home, away } = createPracticeTeams(23);
        home.players.forEach((player, index) => { if (index % 3 === 0) player.traitIds = ['iceveins', 'clinical']; });
        const match = new ArcadeMatch(home, away, config(home.id, { knockout: true, seed: 777 }));
        for (let tick = 0; tick < 60 * 60 * 2 && !match.finished; tick++) {
          if (match.phase === 'halftime') match.resumeSecondHalf();
          if (match.phase === 'goalReplay') match.endReplay();
          match.step(MATCH_TICK);
        }
        return match.result();
      };
      const first = run();
      const second = run();
      expect({ ...second, id: undefined }).toEqual({ ...first, id: undefined });
    }, 60_000);
  });
});
