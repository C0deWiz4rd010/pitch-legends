import { createNewGame } from './data/generators';
import { createInjury, applyInjury, advanceInjury, isPlayerAvailable, setRehabPlan } from './core/injury-engine';
import { SaveService } from './core/services/save.service';
import { prepareTravelEvent, resolveTravelEvent } from './core/travel-engine';

describe('Living world V1.4', () => {
  it('generates the same world, people and managers from the same seed', () => {
    const first = createNewGame({ managerName: 'Mara Voss', clubName: 'Aurora FC', seed: 441401, managerPhilosophy: 'gegenpress' });
    const second = createNewGame({ managerName: 'Mara Voss', clubName: 'Aurora FC', seed: 441401, managerPhilosophy: 'gegenpress' });

    expect(first.world).toEqual(second.world);
    expect(first.teams.map((team) => ({ id: team.id, name: team.name, cityId: team.cityId })))
      .toEqual(second.teams.map((team) => ({ id: team.id, name: team.name, cityId: team.cityId })));
    expect(first.teams.flatMap((team) => team.players.map((player) => `${player.firstName} ${player.lastName}`)))
      .toEqual(second.teams.flatMap((team) => team.players.map((player) => `${player.firstName} ${player.lastName}`)));
    expect(first.managers).toEqual(second.managers);
    expect(first.manager.tacticalPhilosophy).toBe('gegenpress');
  });

  it('produces a materially different league for a different world seed', () => {
    const first = createNewGame({ managerName: 'Coach', clubName: 'Seed FC', seed: 441402 });
    const second = createNewGame({ managerName: 'Coach', clubName: 'Seed FC', seed: 441403 });

    expect(first.world.country.name).not.toBe(second.world.country.name);
    expect(first.world.cities.map((city) => city.name)).not.toEqual(second.world.cities.map((city) => city.name));
    expect(first.teams[1].players[0].id).not.toBe(second.teams[1].players[0].id);
  });

  it('migrates V4 worlds, managers and legacy injuries without modifying the input', () => {
    const source = createNewGame({ managerName: 'Legacy Coach', clubName: 'Legacy FC', seed: 441404 });
    const injuredId = source.teams[0].players[0].id;
    source.version = 4;
    source.teams[0].players[0].injuryWeeks = 3;
    delete (source.teams[0].players[0] as Partial<typeof source.teams[0]['players'][number]>).medical;
    delete (source as Partial<typeof source>).world;
    delete (source as Partial<typeof source>).managers;
    const raw = JSON.stringify(source);

    const migrated = new SaveService().parseImport(raw);

    expect(migrated.version).toBe(5);
    expect(migrated.world.cities).toHaveLength(migrated.teams.length);
    expect(migrated.managers).toHaveLength(migrated.teams.length - 1);
    expect(migrated.teams[0].players.find((player) => player.id === injuredId)?.medical.activeInjury?.diagnosisId).toBe('legacy-knock');
    expect(JSON.stringify(source)).toBe(raw);
  });

  it('creates deterministic injuries and completes a rehabilitation cycle', () => {
    const game = createNewGame({ managerName: 'Medic', clubName: 'Medical FC', seed: 441405 });
    const player = game.teams[0].players[0];
    const context = { seed: 9901, player, cause: 'training' as const, season: 1, week: 4 };

    expect(createInjury(context)).toEqual(createInjury(context));
    applyInjury(player, createInjury(context));
    expect(isPlayerAvailable(player)).toBe(false);
    const before = player.medical.activeInjury!.remainingWeeks;
    const rehab = setRehabPlan(player, 'accelerated', 2);
    expect(rehab.ok).toBe(true);
    expect(rehab.cost).toBeGreaterThan(0);
    expect(player.medical.activeInjury!.remainingWeeks).toBeLessThanOrEqual(before);

    let week = 4;
    while (player.medical.activeInjury && week < 30) advanceInjury(player, 1, ++week, 2);
    expect(isPlayerAvailable(player)).toBe(true);
    expect(player.medical.history).toHaveLength(1);
    expect(player.injuryWeeks).toBe(0);
  });

  it('resolves one deterministic away-travel event exactly once', () => {
    const source = createNewGame({ managerName: 'Traveller', clubName: 'Route FC', seed: 441406 });
    const awayFixtures = source.league.fixtures.filter((fixture) => fixture.awayTeamId === source.clubId);
    let event = null;
    for (const fixture of awayFixtures) {
      source.league.currentWeek = fixture.week;
      event = prepareTravelEvent(source);
      if (event) break;
    }
    expect(event).not.toBeNull();
    const twin = createNewGame({ managerName: 'Traveller', clubName: 'Route FC', seed: 441406 });
    twin.league.currentWeek = event!.week;
    expect(prepareTravelEvent(twin)).toEqual(event);

    expect(resolveTravelEvent(source, event!.id, 'safe')).toBe(true);
    const snapshot = JSON.stringify(source);
    expect(resolveTravelEvent(source, event!.id, 'bold')).toBe(false);
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});
