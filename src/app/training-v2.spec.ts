import { TestBed } from '@angular/core/testing';
import { createNewGame } from './data/generators';
import { TrainingSessionPlan } from './models/game.model';
import { TrainingService } from './core/services/training.service';

describe('Training camp V2', () => {
  let service: TrainingService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TrainingService);
  });

  it('uses the same deterministic outcome regardless of game difficulty', () => {
    const first = createNewGame({ managerName: 'Coach', clubName: 'Coach FC', seed: 1401 });
    const second = structuredClone(first);
    first.settings.difficulty = 'easy';
    second.settings.difficulty = 'hard';
    const attacker = first.teams.find((team) => team.id === first.clubId)!.players.find((player) => player.positionGroup === 'ATT')!;
    const plan: TrainingSessionPlan = {
      id: 'week-one-slot-zero', slot: 0, drillId: 'finishing', scope: 'individual', intensity: 'normal', targetIds: [attacker.id],
    };

    const previewA = service.preview(first, [plan]);
    const previewB = service.preview(second, [plan]);
    expect(previewA).toEqual(previewB);

    const resultA = service.executePlan(first, [plan]);
    const resultB = service.executePlan(second, [plan]);
    expect(resultA).toEqual(resultB);
    expect(resultA.ok).toBe(true);
    expect(first.trainingWeek.slotsUsed).toBe(1);
    expect(first.trainingWeek.completedSessions).toHaveLength(1);
  });

  it('rejects an invalid unit atomically without changing players or slots', () => {
    const game = createNewGame({ managerName: 'Atomic', clubName: 'Atomic FC', seed: 1402 });
    const club = game.teams.find((team) => team.id === game.clubId)!;
    const defenders = club.players.filter((player) => player.positionGroup === 'DEF').slice(0, 2);
    const plan: TrainingSessionPlan = {
      id: 'invalid-unit', slot: 0, drillId: 'tackling', scope: 'unit', intensity: 'light', targetIds: defenders.map((player) => player.id),
    };
    const beforePlayers = structuredClone(club.players);
    const beforeWeek = structuredClone(game.trainingWeek);

    const result = service.executePlan(game, [plan]);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('unit-count');
    expect(club.players).toEqual(beforePlayers);
    expect(game.trainingWeek).toEqual(beforeWeek);
  });

  it('applies group XP and fitness modifiers and prevents duplicate development targets', () => {
    const game = createNewGame({ managerName: 'Unit', clubName: 'Unit FC', seed: 1403 });
    const club = game.teams.find((team) => team.id === game.clubId)!;
    const midfielders = club.players.filter((player) => player.positionGroup === 'MID').slice(0, 3);
    const individual: TrainingSessionPlan = {
      id: 'individual', slot: 0, drillId: 'vision', scope: 'individual', intensity: 'normal', targetIds: [midfielders[0].id],
    };
    const unit: TrainingSessionPlan = {
      id: 'unit', slot: 0, drillId: 'vision', scope: 'unit', intensity: 'normal', targetIds: midfielders.map((player) => player.id),
    };
    const soloPreview = service.preview(game, [individual]).sessions[0].players[0];
    const unitPreview = service.preview(game, [unit]).sessions[0].players[0];
    expect(unitPreview.xpMin).toBeLessThan(soloPreview.xpMin);
    expect(Math.abs(unitPreview.fitnessDelta)).toBeLessThan(Math.abs(soloPreview.fitnessDelta));

    const duplicate = service.preview(game, [individual, { ...individual, id: 'duplicate', slot: 1 }]);
    expect(duplicate.valid).toBe(false);
    expect(duplicate.errors.some((error) => error.startsWith('already-trained'))).toBe(true);
  });

  it('allows an injured player to recover but blocks development training', () => {
    const game = createNewGame({ managerName: 'Medic', clubName: 'Medic FC', seed: 1404 });
    const player = game.teams.find((team) => team.id === game.clubId)!.players[0];
    player.injuryWeeks = 2;
    player.fitness = 50;
    const development: TrainingSessionPlan = { id: 'dev', slot: 0, drillId: 'sprints', scope: 'individual', intensity: 'light', targetIds: [player.id] };
    const recovery: TrainingSessionPlan = { id: 'recovery', slot: 0, drillId: 'recovery', scope: 'individual', intensity: 'light', targetIds: [player.id] };

    expect(service.preview(game, [development]).valid).toBe(false);
    expect(service.executePlan(game, [recovery]).ok).toBe(true);
    expect(player.fitness).toBe(50); // execution is atomic and replaces the club's player collection
    expect(game.teams.find((team) => team.id === game.clubId)!.players.find((candidate) => candidate.id === player.id)!.fitness).toBe(80);
  });
});
