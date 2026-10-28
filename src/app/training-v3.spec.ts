import { TestBed } from '@angular/core/testing';
import { createNewGame } from './data/generators';
import { CAMP_EVENTS } from './data/camp-events';
import { TRAINING_DRILLS } from './data/training-drills';
import { GameState, TrainingSessionPlan } from './models/game.model';
import { Player } from './models/player.model';
import { buildStatBlock, resolveAttribute, resolveHook } from './core/rpg/stat-block';
import { Cond } from './core/rpg/conditions';
import { acuteChronicRatio, addMastery, closeTrainingWeek, ensureTraining, loadRiskFactor, loadZone, mentoringJuniors } from './core/rpg/training-rules';
import { TrainingService } from './core/services/training.service';

function plan(drillId: string, playerIds: string[], extra: Partial<TrainingSessionPlan> = {}): TrainingSessionPlan {
  return { id: `p-${drillId}`, slot: 0, drillId, scope: playerIds.length > 1 ? 'unit' : 'individual', intensity: 'normal', targetIds: playerIds, ...extra };
}

describe('Training camp 3.0', () => {
  let service: TrainingService;
  let game: GameState;
  let club: GameState['teams'][number];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TrainingService);
    game = createNewGame({ managerName: 'Coach', clubName: 'Camp FC', seed: 3001 });
    club = game.teams.find((team) => team.id === game.clubId)!;
  });

  const attacker = () => club.players.find((player) => player.positionGroup === 'ATT')!;
  const trained = (id: string) => club.players.find((player) => player.id === id)!;

  it('has a coherent drill catalogue', () => {
    expect(new Set(TRAINING_DRILLS.map((drill) => drill.id)).size).toBe(TRAINING_DRILLS.length);
    for (const drill of TRAINING_DRILLS.filter((candidate) => candidate.focus !== 'recovery')) {
      expect(drill.buff?.effects.length, drill.id).toBeGreaterThan(0);
      expect(drill.secondary, drill.id).toBeDefined();
      expect(drill.secondary).not.toBe(drill.focus);
    }
    expect(TRAINING_DRILLS.length).toBeGreaterThanOrEqual(15);
  });

  it('turns a session into mastery, load and a buff that the match pipeline applies', () => {
    const player = attacker();
    const result = service.executePlan(game, [plan('finishing', [player.id])]);
    expect(result.ok).toBe(true);
    const after = trained(player.id);
    const training = after.training!;
    expect(training.weekLoad).toBe(2);
    expect(training.mastery.shooting).toBeGreaterThanOrEqual(8);
    expect(training.mastery.dribbling).toBeGreaterThan(0);
    expect(training.buffs.map((buff) => buff.drillId)).toEqual(['finishing']);
    expect(result.sessions[0].players[0].buffLabel).toBeDefined();

    const block = buildStatBlock(after);
    expect(resolveHook(block, 'shotError', 1, 0)).toBeCloseTo(0.92, 5);
    expect(resolveHook(buildStatBlock({ ...after, training: { ...training, buffs: [] } }), 'shotError', 1, 0)).toBe(1);
  });

  it('keeps conditional drill buffs conditional', () => {
    const player = attacker();
    service.executePlan(game, [plan('control', [player.id])]);
    const block = buildStatBlock(trained(player.id));
    const calm = resolveAttribute(block, 'dribbling', 0);
    expect(resolveAttribute(block, 'dribbling', Cond.underPressure)).toBeCloseTo(Math.min(99, calm + 3), 5);
  });

  it('retires buffs and moves the week load into the history when the week closes', () => {
    const player = attacker();
    service.executePlan(game, [plan('finishing', [player.id], { intensity: 'intense' })]);
    service.rollWeek(game);
    const training = trained(player.id).training!;
    expect(training.buffs).toEqual([]);
    expect(training.weekLoad).toBe(0);
    expect(training.load).toEqual([2, 2, 2, 3.5]);
    expect(training.load).toHaveLength(4);
  });

  it('flags a sudden jump in load and punishes it with injury risk', () => {
    const player = attacker();
    player.fitness = 100;
    const normal = service.preview(game, [plan('finishing', [player.id])]).sessions[0].players[0];
    const intense = service.preview(game, [plan('finishing', [player.id], { intensity: 'intense' })]).sessions[0].players[0];
    expect(normal.loadZone).toBe('green');
    expect(intense.loadZone).toBe('red');
    expect(intense.injuryRisk).toBeGreaterThan(normal.injuryRisk * 2);
    expect(loadZone(1.3)).toBe('green');
    expect(loadZone(1.5)).toBe('yellow');
    expect(loadRiskFactor(1)).toBe(1);
    expect(loadRiskFactor(2)).toBeGreaterThan(loadRiskFactor(1.5));
  });

  it('adapts to a progressive build-up of load', () => {
    const player = attacker();
    ensureTraining(player).load = [3.5, 3.5, 3.5, 3.5];
    expect(acuteChronicRatio(player, 3.5)).toBeCloseTo(1, 5);
    closeTrainingWeek(player);
    expect(player.training!.load).toEqual([3.5, 3.5, 3.5, 0]);
    expect(acuteChronicRatio(player, 3.5)).toBeGreaterThan(1.3);
  });

  it('rewards mastery milestones and unlocks the trait at 100 without skill points', () => {
    const player = attacker();
    player.traitIds = [];
    expect(addMastery(player, 'pace', 20).milestone).toBeUndefined();
    expect(addMastery(player, 'pace', 10).milestone).toBe(25);
    expect(addMastery(player, 'pace', 25).milestone).toBe(50);
    const final = addMastery(player, 'pace', 80);
    expect(final.value).toBe(100);
    expect(final.traitUnlocked).toBe('speedster');
    expect(addMastery(player, 'pace', 10).traitUnlocked).toBeUndefined();

    const target = attacker();
    target.traitIds = [];
    ensureTraining(target).mastery.shooting = 95;
    const skillPoints = target.skillPoints;
    service.executePlan(game, [plan('finishing', [target.id])]);
    expect(trained(target.id).traitIds).toContain('clinical');
    expect(trained(target.id).skillPoints).toBe(skillPoints);
  });

  it('occasionally turns growth into a breakthrough worth two points', () => {
    const original = structuredClone(club.players);
    const base = attacker();
    let found = false;
    for (let week = 1; week <= 400 && !found; week++) {
      game.league.currentWeek = week;
      game.trainingWeek = { ...game.trainingWeek, slotsUsed: 0, completedSessions: [] };
      club.players = structuredClone(original);
      const player = trained(base.id);
      player.potential = 99;
      player.attributes.shooting = 50;
      const result = service.executePlan(game, [plan('finishing', [player.id])]);
      const entry = result.sessions[0].players[0];
      if (entry.breakthrough) {
        found = true;
        expect(trained(player.id).attributes.shooting).toBe(52);
        expect(entry.masteryGained).toBeGreaterThanOrEqual(16);
      }
    }
    expect(found).toBe(true);
  });

  it('lets a senior mentor juniors in a unit session', () => {
    const mids = club.players.filter((player) => player.positionGroup === 'MID').slice(0, 3);
    mids[0].age = 31; mids[0].level = 14;
    mids[1].age = 19;
    mids[2].age = 26;
    expect([...mentoringJuniors(mids)]).toEqual([mids[1].id]);
    mids[0].age = 26;
    expect(mentoringJuniors(mids).size).toBe(0);

    mids[0].age = 31;
    const withMentor = service.preview(game, [plan('vision', mids.map((player) => player.id))]).sessions[0].players;
    mids[0].age = 26;
    const without = service.preview(game, [plan('vision', mids.map((player) => player.id))]).sessions[0].players;
    expect(withMentor[1].mentored).toBe(true);
    expect(withMentor[1].xpMin).toBeGreaterThan(without[1].xpMin);
    expect(withMentor[2].xpMin).toBe(without[2].xpMin);
  });

  it('scales XP and mastery with the grade of a self-played drill', () => {
    const player = attacker();
    const grades = (['C', 'B', 'S'] as const).map((grade) => service.preview(game, [plan('finishing', [player.id], { grade })]).sessions[0].players[0]);
    expect(grades[0].xpMin).toBeLessThan(grades[1].xpMin);
    expect(grades[1].xpMin).toBeLessThan(grades[2].xpMin);
    expect(grades[2].masteryGain).toBeGreaterThan(grades[1].masteryGain);
  });

  it('offers one deterministic camp event per week and applies a choice only once', () => {
    const view = service.campEvent(game);
    expect(CAMP_EVENTS).toContain(view.event);
    expect(service.campEvent(structuredClone(game)).event.id).toBe(view.event.id);
    const before = structuredClone(club.players.map((player) => ({ morale: player.morale, fitness: player.fitness })));
    const coins = club.coins;
    const outcome = service.resolveCampEvent(game, 1);
    expect(outcome.ok).toBe(true);
    expect(game.trainingWeek.eventChoice).toBe(1);
    expect(service.resolveCampEvent(game, 0)).toEqual({ ok: false, error: 'event-done' });
    expect(club.coins).toBeGreaterThanOrEqual(coins + Math.min(0, view.event.options[1].effect.coins ?? 0));
    expect(club.players.length).toBe(before.length);
  });

  it('refuses a camp option the club cannot pay for', () => {
    const paid = [0, 1].find((option) => (service.campEvent(game).event.options[option as 0 | 1].effect.coins ?? 0) < 0);
    if (paid === undefined) {
      for (let week = 1; week < 40 && paid === undefined; week++) {
        game.league.currentWeek = week;
        const found = [0, 1].find((option) => (service.campEvent(game).event.options[option as 0 | 1].effect.coins ?? 0) < 0);
        if (found !== undefined) {
          club.coins = 0;
          expect(service.resolveCampEvent(game, found as 0 | 1)).toEqual({ ok: false, error: 'cannot-afford' });
          return;
        }
      }
      throw new Error('no paid camp option found');
    }
    club.coins = 0;
    expect(service.resolveCampEvent(game, paid as 0 | 1)).toEqual({ ok: false, error: 'cannot-afford' });
  });

  it('develops young players of other clubs deterministically and leaves veterans alone', () => {
    const other = game.teams.find((team) => team.id !== game.clubId)!;
    const copy = () => structuredClone(other.players) as Player[];
    const first = copy();
    const second = copy();
    for (const player of first) player.age = player.age % 2 ? 19 : 33;
    for (const player of second) player.age = player.age % 2 ? 19 : 33;
    const snapshot = structuredClone(first);
    for (let week = 1; week <= 60; week++) {
      service.simulateAiTrainingWeek(first, 3, `x|1|${week}`);
      service.simulateAiTrainingWeek(second, 3, `x|1|${week}`);
    }
    expect(first).toEqual(second);
    const veterans = first.filter((player) => player.age === 33);
    expect(veterans.map((player) => player.attributes)).toEqual(snapshot.filter((player) => player.age === 33).map((player) => player.attributes));
    const gained = first.filter((player) => player.age === 19 && player.overall > snapshot.find((candidate) => candidate.id === player.id)!.overall);
    expect(gained.length).toBeGreaterThan(0);
  });
});
