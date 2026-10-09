import { Injectable, inject } from '@angular/core';
import { PersistentStore, SaveResult, StoreOperation } from '../storage/persistent-store';
import { defaultSettings, GameState, SAVE_VERSION } from '../../models/game.model';
import { ensureGameVisuals } from '../visual-identity';
import { createManagerVisualIdentity, hash32 } from '../visual-identity';
import { countryRoot, generatePersonName, generateWorld } from '../../data/world-generator';
import { ManagerProfile } from '../../models/game.model';
import { createSecondDivision } from '../../data/generators';
import { emptyTeamFinance } from '../../models/career.model';
import { createCup } from '../career/cup';

export const CAREER_KEY = 'pitch-legends:save:v6';
const V5_STORAGE_KEY = 'pitch-legends:save:v5';
const V4_STORAGE_KEY = 'pitch-legends:save:v4';
const V3_STORAGE_KEY = 'pitch-legends:save:v3';
const V2_STORAGE_KEY = 'pitch-legends:save:v2';
const LEGACY_STORAGE_KEY = 'pitch-legends:save:v1';
/** The career as it was when the previous session started; offered when the current save is damaged. */
export const LAST_GOOD_BACKUP_KEY = 'pitch-legends:backup:career-last-good';
/** A damaged save is moved here untouched, so it can still be exported and inspected. */
export const CORRUPT_BACKUP_KEY = 'pitch-legends:backup:career-corrupt';
export const migrationBackupKey = (fromVersion: number) => `pitch-legends:backup:career-before-v${SAVE_VERSION}-from-v${fromVersion}`;

export type LoadResult =
  | { status: 'ok'; state: GameState; migratedFrom: number | null }
  | { status: 'empty' }
  | { status: 'corrupt'; reason: 'parse' | 'invalid' | 'migration'; hasBackup: boolean };

/** A file name every operating system accepts, built from the manager name and season. */
export function exportFileName(managerName: string, season: number): string {
  const name = managerName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase();
  return `pitch-legends-${name || 'career'}-s${Math.max(1, Math.floor(season) || 1)}.json`;
}

@Injectable({ providedIn: 'root' })
export class SaveService {
  readonly store = inject(PersistentStore);

  /** Reads the career. A damaged save is never dropped: it is kept as a backup and reported. */
  load(): LoadResult {
    const key = [CAREER_KEY, V5_STORAGE_KEY, V4_STORAGE_KEY].find((candidate) => this.store.has(candidate));
    if (!key) return { status: 'empty' };
    const raw = this.store.get(key)!;
    const result = this.parseRaw(raw);
    if (result.status !== 'ok') {
      if (this.store.get(CORRUPT_BACKUP_KEY) !== raw) void this.store.set(CORRUPT_BACKUP_KEY, raw);
      return { ...result, hasBackup: this.hasBackup() };
    }
    if (result.migratedFrom !== null) {
      // Keep the save exactly as the older version wrote it before anything is converted.
      void this.store.batch([
        { key: migrationBackupKey(result.migratedFrom), value: raw },
        { key: CAREER_KEY, value: JSON.stringify(result.state) },
        ...(key !== CAREER_KEY ? [{ key, value: null }] : []),
      ]);
    } else {
      void this.store.set(LAST_GOOD_BACKUP_KEY, raw);
    }
    return result;
  }

  /** Loads the last good backup into the main slot. */
  restoreBackup(): LoadResult {
    const raw = this.store.get(LAST_GOOD_BACKUP_KEY) ?? this.latestMigrationBackup();
    if (!raw) return { status: 'empty' };
    const result = this.parseRaw(raw);
    if (result.status !== 'ok') return { ...result, hasBackup: false };
    void this.store.set(CAREER_KEY, JSON.stringify(result.state));
    return result;
  }

  hasBackup(): boolean {
    const raw = this.store.get(LAST_GOOD_BACKUP_KEY) ?? this.latestMigrationBackup();
    return !!raw && this.parseRaw(raw).status === 'ok';
  }

  /** The damaged save as it was found, for export. */
  corruptSave(): string | null {
    return this.store.get(CORRUPT_BACKUP_KEY);
  }

  save(state: GameState, extra: StoreOperation[] = []): Promise<SaveResult> {
    let json: string;
    try {
      json = JSON.stringify(state);
    } catch (error) {
      return Promise.resolve({ ok: false, reason: 'unknown', message: String(error) });
    }
    return this.store.batch([{ key: CAREER_KEY, value: json }, ...extra]);
  }

  /** Deletes the career and its checkpoint; backups stay until a new career has been saved. */
  clear(): Promise<SaveResult> {
    return this.store.remove(CAREER_KEY, V5_STORAGE_KEY, V4_STORAGE_KEY, CORRUPT_BACKUP_KEY);
  }

  hasSave(): boolean {
    return [CAREER_KEY, V5_STORAGE_KEY, V4_STORAGE_KEY].some((key) => this.store.has(key));
  }

  hasLegacySave(): boolean {
    return [LEGACY_STORAGE_KEY, V2_STORAGE_KEY, V3_STORAGE_KEY].some((key) => this.store.has(key));
  }

  /** Serialise the current state to a downloadable JSON file. */
  exportToFile(state: GameState): void {
    this.download(JSON.stringify(state, null, 2), exportFileName(state.managerName, state.league.season));
  }

  /** Offers the damaged save as a file, exactly as it was stored. */
  exportCorrupt(): void {
    const raw = this.corruptSave();
    if (raw) this.download(raw, `pitch-legends-damaged-${new Date().toISOString().slice(0, 10)}.json`);
  }

  /** Parse an imported JSON string into a GameState (throws on invalid data). */
  parseImport(json: string): GameState {
    const parsed: unknown = JSON.parse(json);
    if (!this.validateBase(parsed)) {
      throw new Error('Invalid save file.');
    }
    return this.upgrade(parsed as GameState);
  }

  private parseRaw(raw: string): { status: 'ok'; state: GameState; migratedFrom: number | null } | { status: 'corrupt'; reason: 'parse' | 'invalid' | 'migration' } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'corrupt', reason: 'parse' };
    }
    if (!this.validateBase(parsed)) return { status: 'corrupt', reason: 'invalid' };
    try {
      const version = (parsed as GameState).version;
      return { status: 'ok', state: this.upgrade(parsed as GameState), migratedFrom: version === SAVE_VERSION ? null : version };
    } catch {
      return { status: 'corrupt', reason: 'migration' };
    }
  }

  private upgrade(parsed: GameState): GameState {
    const game = this.migrateToV6(this.migrateToV5(parsed));
    game.settings = { ...defaultSettings(), ...game.settings };
    game.trainingWeek = this.normaliseTrainingWeek(game.trainingWeek);
    return ensureGameVisuals(game);
  }

  private latestMigrationBackup(): string | null {
    const keys = this.store.keys('pitch-legends:backup:career-before-').sort();
    return keys.length ? this.store.get(keys[keys.length - 1]) : null;
  }

  private download(content: string, fileName: string): void {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
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
