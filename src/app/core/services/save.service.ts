import { Injectable } from '@angular/core';
import { defaultSettings, GameState, SAVE_VERSION } from '../../models/game.model';
import { ensureGameVisuals } from '../visual-identity';
import { createManagerVisualIdentity, hash32 } from '../visual-identity';
import { countryRoot, generatePersonName, generateWorld } from '../../data/world-generator';
import { ManagerProfile } from '../../models/game.model';
import { createSecondDivision } from '../../data/generators';
import { emptyTeamFinance } from '../../models/career.model';
import { createCup } from '../career/cup';

const STORAGE_KEY = 'pitch-legends:save:v6';
const V5_STORAGE_KEY = 'pitch-legends:save:v5';
const V4_STORAGE_KEY = 'pitch-legends:save:v4';
const V3_STORAGE_KEY = 'pitch-legends:save:v3';
const V2_STORAGE_KEY = 'pitch-legends:save:v2';
const LEGACY_STORAGE_KEY = 'pitch-legends:save:v1';

@Injectable({ providedIn: 'root' })
export class SaveService {
  load(): GameState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(V5_STORAGE_KEY) ?? localStorage.getItem(V4_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GameState;
      if (!this.validateBase(parsed)) return null;
      const migrated = this.migrateToV6(this.migrateToV5(parsed));
      migrated.settings = { ...defaultSettings(), ...migrated.settings };
      migrated.trainingWeek = this.normaliseTrainingWeek(migrated.trainingWeek);
      const ready = ensureGameVisuals(migrated);
      if (parsed.version !== SAVE_VERSION) this.save(ready);
      return ready;
    } catch {
      return null;
    }
  }

  save(state: GameState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or unavailable — fail silently, the game stays playable.
    }
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(V5_STORAGE_KEY);
    localStorage.removeItem(V4_STORAGE_KEY);
  }

  hasSave(): boolean {
    return !!localStorage.getItem(STORAGE_KEY) || !!localStorage.getItem(V5_STORAGE_KEY) || !!localStorage.getItem(V4_STORAGE_KEY);
  }

  hasLegacySave(): boolean {
    return !!localStorage.getItem(LEGACY_STORAGE_KEY) || !!localStorage.getItem(V2_STORAGE_KEY) || !!localStorage.getItem(V3_STORAGE_KEY);
  }

  /** Serialise the current state to a downloadable JSON file. */
  exportToFile(state: GameState): void {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pitch-legends-${state.managerName}-s${state.league.season}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Parse an imported JSON string into a GameState (throws on invalid data). */
  parseImport(json: string): GameState {
    const parsed: unknown = JSON.parse(json);
    if (!this.validateBase(parsed)) {
      throw new Error('Invalid save file.');
    }
    const game = this.migrateToV6(this.migrateToV5(parsed as GameState));
    game.settings = { ...defaultSettings(), ...game.settings };
    game.trainingWeek = this.normaliseTrainingWeek(game.trainingWeek);
    return ensureGameVisuals(game);
  }

  private normaliseTrainingWeek(training: GameState['trainingWeek']): GameState['trainingWeek'] {
    return {
      season: training.season,
      week: training.week,
      slotsUsed: Math.max(0, Math.min(3, training.slotsUsed ?? 0)),
      maxSlots: 3,
      completedSessions: Array.isArray(training.completedSessions) ? training.completedSessions : [],
    };
  }

  private migrateToV5(source: GameState): GameState {
    const game = structuredClone(source) as GameState;
    const seed = game.world?.seed ?? hash32(`${game.league.id}|${game.createdAt}|v5`);
    const teamIds = game.teams.map((team) => team.id);
    game.world ??= generateWorld(seed, teamIds, game.teams.find((team) => team.id === game.clubId)?.name ?? 'Legends FC').world;
    const cityByTeam = new Map(game.world.cities.map((city) => [city.teamId, city.id]));
    const existingManager = game.manager as Partial<ManagerProfile>;
    game.manager = this.normaliseManager(existingManager, game.clubId, game.managerName, seed, 0, game.teams[0]?.kit.primary ?? '#37d8ff');
    const incomingManagers = Array.isArray(game.managers) ? game.managers : [];
    game.managers = game.teams
      .filter((team) => team.id !== game.clubId)
      .map((team, index) => this.normaliseManager(incomingManagers.find((manager) => manager.clubId === team.id), team.id, undefined, seed, index + 1, team.kit.primary));
    for (const [index, team] of game.teams.entries()) {
      team.cityId ??= cityByTeam.get(team.id) ?? `city-${index + 1}`;
      team.managerId ??= team.id === game.clubId ? game.manager.id : game.managers.find((manager) => manager.clubId === team.id)?.id ?? `manager-${team.id}`;
      team.rivalTeamIds ??= game.world.rivalries.flatMap((rivalry) => rivalry.teamAId === team.id ? [rivalry.teamBId] : rivalry.teamBId === team.id ? [rivalry.teamAId] : []);
      for (const player of team.players) this.normaliseMedical(player, game.league.season, game.league.currentWeek);
    }
    for (const player of game.transfers.freeAgents) this.normaliseMedical(player, game.league.season, game.league.currentWeek);
    game.version = 5;
    return game;
  }

  /**
   * Version 6: second division, cup, club finances, archive, board, scouting and academy.
   * Existing clubs, players and results stay untouched; the new division is added around them.
   */
  private migrateToV6(game: GameState): GameState {
    const season = game.league.season;
    game.league.tier ??= 1;
    game.otherLeagues ??= [];
    for (const team of game.teams) team.finance ??= emptyTeamFinance(season);
    if (!game.otherLeagues.length) {
      const second = createSecondDivision(game.world, `${game.league.id}-d2`, season, game.teams.length, game.teams);
      second.league.currentWeek = game.league.currentWeek;
      // Weeks already played in the top flight are played in the new division as goalless draws on paper.
      for (const fixture of second.league.fixtures) {
        if (fixture.week >= game.league.currentWeek) continue;
        fixture.homeScore = 0;
        fixture.awayScore = 0;
        fixture.played = true;
      }
      game.teams.push(...second.teams);
      game.managers.push(...second.managers);
      game.otherLeagues.push(second.league);
    }
    game.cup ??= createCup({
      teams: game.teams, leagues: [game.league, ...game.otherLeagues], season, seed: game.world.seed,
      totalWeeks: game.league.totalWeeks, name: `${countryRoot(game.world)} Cup`, firstWeek: game.league.currentWeek,
    });
    game.archive ??= [];
    game.board ??= { confidence: 60, warnedSeason: null, expectedPosition: game.objectives.find((objective) => objective.type === 'league-position')?.target ?? 6, jobOffer: null };
    game.scouting ??= [];
    game.academy ??= { season, prospects: [] };
    game.version = SAVE_VERSION;
    return game;
  }

  private normaliseManager(source: Partial<ManagerProfile> | undefined, clubId: string, displayName: string | undefined, seed: number, index: number, clubPrimary: string): ManagerProfile {
    const generated = generatePersonName(seed, `legacy-manager-${index}`);
    const parts = displayName?.trim().split(/\s+/).filter(Boolean) ?? [];
    const id = source?.id ?? `manager-${hash32(`${seed}|legacy|${index}`).toString(36)}`;
    return {
      id,
      clubId,
      firstName: source?.firstName ?? parts[0] ?? generated.firstName,
      lastName: source?.lastName ?? (parts.length > 1 ? parts.slice(1).join(' ') : generated.lastName),
      age: source?.age ?? 44 + index % 14,
      nationality: source?.nationality ?? generated.nationality,
      visuals: source?.visuals ?? createManagerVisualIdentity(id, clubPrimary),
      attributes: source?.attributes ?? { coaching: 55, tactics: 55, scouting: 55, leadership: 55, negotiation: 55, youthDevelopment: 55 },
      tacticalPhilosophy: source?.tacticalPhilosophy ?? 'balanced',
      recruitmentPhilosophy: source?.recruitmentPhilosophy ?? 'value',
      preferredFormation: source?.preferredFormation ?? '4-3-3',
      traits: source?.traits ?? ['analyst', 'motivator'],
      level: source?.level ?? 1,
      xp: source?.xp ?? 0,
      xpToNext: source?.xpToNext ?? 250,
      skillPoints: source?.skillPoints ?? 0,
      perks: source?.perks ?? {},
    };
  }

  private normaliseMedical(player: GameState['teams'][number]['players'][number], season: number, week: number): void {
    if (player.medical) return;
    player.medical = {
      activeInjury: player.injuryWeeks > 0 ? {
        id: `injury-${player.id}-legacy`, diagnosisId: 'legacy-knock', area: 'ankle', severity: player.injuryWeeks > 4 ? 'serious' : player.injuryWeeks > 2 ? 'moderate' : 'minor',
        cause: 'legacy', fixtureId: null, matchMinute: null, initialWeeks: player.injuryWeeks, remainingWeeks: player.injuryWeeks,
        rehabPlan: 'standard', recurrenceRisk: .05, returnFitness: 75, occurredSeason: season, occurredWeek: week,
      } : null,
      history: [], recurrenceUntilWeek: null,
    };
  }

  private validateBase(value: unknown): value is GameState {
    if (!value || typeof value !== 'object') return false;
    const g = value as Partial<GameState>;
    if (![4, 5, SAVE_VERSION].includes(g.version ?? -1) || typeof g.clubId !== 'string') return false;
    if (!Array.isArray(g.teams) || !g.teams.length || !g.league || !Array.isArray(g.league.fixtures)) return false;
    if (!g.settings || !['de', 'en'].includes(g.settings.locale) || ![3, 5, 8].includes(g.settings.matchDuration)) return false;
    if (!g.manager || !g.trainingWeek || !Array.isArray(g.objectives) || !g.transfers) return false;
    if (!Array.isArray(g.transfers.freeAgents) || !Array.isArray(g.transfers.negotiations) || !Array.isArray(g.transfers.loans)) return false;
    return g.teams.every(
      (team) =>
        !!team &&
        typeof team.id === 'string' &&
        Array.isArray(team.players) &&
        team.players.every((player) => !!player.archetype && !!player.talentRanks && !!player.personalGoal),
    );
  }
}
