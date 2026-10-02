import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Delaunay } from 'd3-delaunay';
import { GameStateService } from '../../core/services/game-state.service';
import { TravelService } from '../../core/services/travel.service';
import { playerName } from '../../core/ratings';
import { Fixture } from '../../models/league.model';
import { TravelEffect } from '../../models/world.model';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { PlayerPortraitComponent } from '../../shared/components/player-portrait.component';
import { ManagerPortraitComponent } from '../../shared/components/manager-portrait.component';
import { MiniKitComponent } from '../../shared/components/mini-kit.component';
import { I18nService } from '../../core/services/i18n.service';
import { computeStandings } from '../../core/standings';
import { CUP_ROUND_LABELS } from '../../core/career/cup';
import { PROMOTION_PLACES } from '../../core/career/divisions';
import { trophiesOf } from '../../core/career/season-review';
import { CupRoundKey, CupTie } from '../../models/career.model';

type LeagueTab = 'overview' | 'fixtures' | 'map' | 'stats' | 'cup' | 'archive';

@Component({
  selector: 'app-league',
  imports: [ClubCrestComponent, PlayerPortraitComponent, ManagerPortraitComponent, MiniKitComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './league.page.html',
  styleUrl: './league.page.scss',
})
export class LeaguePage {
  protected readonly gs = inject(GameStateService);
  private readonly travel = inject(TravelService);
  private readonly i18n = inject(I18nService);
  protected readonly playerName = playerName;

  protected readonly tab = signal<LeagueTab>('overview');
  protected readonly tabs: Array<{ key: LeagueTab; de: string; en: string }> = [
    { key: 'overview', de: 'ÜBERSICHT', en: 'OVERVIEW' },
    { key: 'fixtures', de: 'SPIELTAGE', en: 'FIXTURES' },
    { key: 'cup', de: 'POKAL', en: 'CUP' },
    { key: 'map', de: 'KARTE', en: 'MAP' },
    { key: 'stats', de: 'STATISTIKEN', en: 'STATS' },
    { key: 'archive', de: 'ARCHIV', en: 'ARCHIVE' },
  ];
  /** Division shown on the page; defaults to the player's division. */
  protected readonly viewLeagueId = signal<string | null>(null);
  protected readonly viewLeague = computed(() => {
    const leagues = this.gs.leagues();
    return leagues.find((league) => league.id === this.viewLeagueId()) ?? this.gs.game()?.league ?? null;
  });
  protected readonly viewTeams = computed(() => {
    const ids = new Set(this.viewLeague()?.teamIds ?? []);
    return this.gs.game()?.teams.filter((team) => ids.has(team.id)) ?? [];
  });
  protected readonly standings = computed(() => {
    const league = this.viewLeague();
    return league ? computeStandings(this.viewTeams(), league.fixtures) : [];
  });
  protected readonly promotionPlaces = PROMOTION_PLACES;
  protected readonly cup = computed(() => this.gs.game()?.cup ?? null);
  protected readonly cupRounds = computed(() => {
    const cup = this.cup();
    if (!cup) return [];
    return cup.rounds.map((round) => ({ round, ties: cup.ties.filter((tie) => tie.round === round.round) }));
  });
  protected readonly archive = computed(() => [...(this.gs.game()?.archive ?? [])].reverse());
  protected readonly trophies = computed(() => {
    const game = this.gs.game();
    return game ? trophiesOf(game, game.clubId) : { leagues: [], cups: [], promotions: [] };
  });
  /** Clubs with the most titles across the archive. */
  protected readonly hallOfFame = computed(() => {
    const game = this.gs.game();
    if (!game) return [];
    return game.teams.map((team) => ({ team, ...trophiesOf(game, team.id) }))
      .map((entry) => ({ ...entry, total: entry.leagues.length * 2 + entry.cups.length }))
      .filter((entry) => entry.total > 0).sort((a, b) => b.total - a.total).slice(0, 8);
  });
  protected readonly viewWeek = signal(this.gs.currentWeek());
  protected readonly selectedTeamId = signal(this.gs.playerTeam()?.id ?? '');
  protected readonly clubId = computed(() => this.gs.playerTeam()?.id ?? '');
  protected readonly world = computed(() => this.gs.game()?.world ?? null);
  protected readonly selectedTeam = computed(() => this.gs.teamById(this.selectedTeamId()) ?? this.gs.playerTeam());
  protected readonly selectedCity = computed(() => this.world()?.cities.find((city) => city.teamId === this.selectedTeamId()) ?? null);
  protected readonly selectedManager = computed(() => this.gs.managerForTeam(this.selectedTeamId()) ?? null);
  protected readonly currentEvent = computed(() => {
    const fixture = this.gs.nextFixture();
    return fixture ? this.world()?.travelEvents.find((event) => event.fixtureId === fixture.id) ?? null : null;
  });
  protected readonly weekFixtures = computed<Fixture[]>(() => this.viewLeague()?.fixtures.filter((fixture) => fixture.week === this.viewWeek()) ?? []);
  protected readonly mapCities = computed(() => {
    const ids = new Set(this.viewLeague()?.teamIds ?? []);
    return this.world()?.cities.filter((city) => ids.has(city.teamId)) ?? [];
  });
  /** Travel network of the division on show (Delaunay neighbours, as in the world generator). */
  protected readonly mapRoutes = computed(() => {
    const cities = this.mapCities();
    if (cities.length < 3) return [];
    const delaunay = Delaunay.from(cities, (city) => city.position.x, (city) => city.position.y);
    const routes: Array<{ id: string; fromCityId: string; toCityId: string }> = [];
    cities.forEach((city, index) => {
      for (const neighbour of delaunay.neighbors(index)) {
        if (neighbour > index) routes.push({ id: `${city.id}-${cities[neighbour].id}`, fromCityId: city.id, toCityId: cities[neighbour].id });
      }
    });
    return routes;
  });
  protected readonly regionCells = computed(() => {
    const regions = this.world()?.regions ?? [];
    if (!regions.length) return [];
    const diagram = Delaunay.from(regions, (region) => region.centre.x, (region) => region.centre.y).voronoi([0, 0, 960, 600]);
    return regions.map((region, index) => ({ region, path: diagram.renderCell(index) }));
  });
  protected readonly topAssists = computed(() => {
    const game = this.gs.game();
    if (!game) return [];
    return this.viewTeams().flatMap((team) => team.players.map((player) => ({ player, team })))
      .sort((a, b) => b.player.seasonStats.assists - a.player.seasonStats.assists || b.player.overall - a.player.overall).slice(0, 10);
  });
  protected readonly topScorers = computed(() => this.viewTeams().flatMap((team) => team.players.map((player) => ({ player, team })))
    .filter((entry) => entry.player.seasonStats.goals > 0)
    .sort((a, b) => b.player.seasonStats.goals - a.player.seasonStats.goals).slice(0, 12));

  /** Further leaderboards: average rating (min. 3 apps), clean sheets and discipline. */
  protected readonly leaders = computed(() => {
    const game = this.gs.game();
    if (!game) return [];
    const all = this.viewTeams().flatMap((team) => team.players.map((player) => ({ player, team })));
    const top = (entries: typeof all, value: (entry: (typeof all)[number]) => number) =>
      entries.map(entry => ({ ...entry, value: value(entry) })).filter(entry => entry.value > 0)
        .sort((a, b) => b.value - a.value || b.player.overall - a.player.overall).slice(0, 8);
    return [
      { key: 'rating', de: 'Ø NOTE', en: 'AVG RATING', unit: 'Ø',
        entries: top(all.filter(entry => entry.player.seasonStats.appearances >= 3), entry => Math.round(entry.player.seasonStats.ratingSum / entry.player.seasonStats.appearances * 10) / 10) },
      { key: 'clean', de: 'WEISSE WESTE', en: 'CLEAN SHEETS', unit: 'CS',
        entries: top(all.filter(entry => entry.player.positionGroup === 'GK'), entry => entry.player.seasonStats.cleanSheets) },
      { key: 'cards', de: 'KARTEN', en: 'CARDS', unit: '▮',
        entries: top(all, entry => entry.player.seasonStats.yellowCards + entry.player.seasonStats.redCards * 2) },
    ];
  });

  constructor() {
    this.travel.ensureCurrent();
  }

  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }
  protected roundLabel(key: CupRoundKey | 'winner'): string { return this.text(CUP_ROUND_LABELS[key].de, CUP_ROUND_LABELS[key].en); }
  protected tieScore(tie: CupTie): string {
    if (!tie.played) return 'VS';
    const suffix = tie.penalties ? ` (${tie.penalties.home}:${tie.penalties.away} ${this.text('i.E.', 'pens')})` : tie.extraTime ? ` ${this.text('n.V.', 'aet')}` : '';
    return `${tie.homeScore}:${tie.awayScore}${suffix}`;
  }
  protected zone(rank: number, total: number): 'up' | 'down' | '' {
    const tier = this.viewLeague()?.tier ?? 1;
    if (tier === 2 && rank < this.promotionPlaces) return 'up';
    if (tier === 1 && rank >= total - this.promotionPlaces && this.gs.leagues().length > 1) return 'down';
    return '';
  }
  protected selectLeague(id: string): void {
    this.viewLeagueId.set(id);
    const first = this.gs.leagues().find((league) => league.id === id)?.teamIds[0];
    if (first && !this.viewLeague()?.teamIds.includes(this.selectedTeamId())) this.selectedTeamId.set(first);
  }
  protected moveTab(event: KeyboardEvent, from: LeagueTab): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = this.tabs.findIndex((tab) => tab.key === from);
    const next = this.tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) % this.tabs.length];
    this.tab.set(next.key);
    (document.getElementById(`league-tab-${next.key}`) as HTMLElement | null)?.focus();
  }
  protected translate(key: string, params?: Record<string, string | number>): string { return this.i18n.t(key, params); }
  protected teamName(id: string): string { return this.gs.teamById(id)?.name ?? '—'; }
  protected teamShort(id: string): string { return this.gs.teamById(id)?.shortName ?? '—'; }
  protected selectTeam(id: string): void { this.selectedTeamId.set(id); }
  protected prevWeek(): void { this.viewWeek.update((week) => Math.max(1, week - 1)); }
  protected nextWeek(): void { this.viewWeek.update((week) => Math.min(this.gs.totalWeeks(), week + 1)); }
  protected outlinePoints(): string { return this.world()?.country.outline.map((point) => `${point.x},${point.y}`).join(' ') ?? ''; }
  protected cityFor(teamId: string) { return this.world()?.cities.find((city) => city.teamId === teamId); }
  protected regionName(regionId: string | undefined): string { return this.world()?.regions.find((region) => region.id === regionId)?.name ?? ''; }
  protected cityById(cityId: string) { return this.world()?.cities.find((city) => city.id === cityId); }
  protected teamForPlayer(playerId: string) { return this.gs.game()?.teams.find((team) => team.players.some((player) => player.id === playerId)); }
  protected managerFor(teamId: string) { return this.gs.managerForTeam(teamId); }
  protected formFor(teamId: string): string[] {
    return (this.viewLeague()?.fixtures ?? []).filter((fixture) => fixture.played && (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId)).slice(-5).map((fixture) => {
      const scored = fixture.homeTeamId === teamId ? fixture.homeScore! : fixture.awayScore!;
      const conceded = fixture.homeTeamId === teamId ? fixture.awayScore! : fixture.homeScore!;
      return scored > conceded ? 'W' : scored < conceded ? 'L' : 'D';
    });
  }
  protected fixtureDistance(fixture: Fixture): number {
    const a = this.cityFor(fixture.homeTeamId);
    const b = this.cityFor(fixture.awayTeamId);
    return a && b ? Math.round(Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) * 1.25) : 0;
  }
  protected travelMode(distance: number): string { return distance < 180 ? 'BUS' : distance <= 420 ? 'TRAIN' : 'PLANE'; }
  protected resolveEvent(eventId: string, choiceId: string): void { this.travel.resolve(eventId, choiceId); }
  protected effectLabel(effect: TravelEffect): string {
    return [effect.fitness ? `${effect.fitness > 0 ? '+' : ''}${effect.fitness} FIT` : '', effect.morale ? `${effect.morale > 0 ? '+' : ''}${effect.morale} MOR` : '', effect.coins ? `${effect.coins > 0 ? '+' : ''}${Math.round(effect.coins / 1000)}K` : '', effect.scoutReport ? 'SCOUT' : '', effect.injuryRisk ? `${Math.round(effect.injuryRisk * 100)}% RISK` : ''].filter(Boolean).join(' · ');
  }
}
