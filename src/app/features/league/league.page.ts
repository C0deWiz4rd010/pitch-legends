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

type LeagueTab = 'overview' | 'fixtures' | 'map' | 'stats';

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
  protected readonly weekFixtures = computed<Fixture[]>(() => this.gs.game()?.league.fixtures.filter((fixture) => fixture.week === this.viewWeek()) ?? []);
  protected readonly regionCells = computed(() => {
    const regions = this.world()?.regions ?? [];
    if (!regions.length) return [];
    const diagram = Delaunay.from(regions, (region) => region.centre.x, (region) => region.centre.y).voronoi([0, 0, 960, 600]);
    return regions.map((region, index) => ({ region, path: diagram.renderCell(index) }));
  });
  protected readonly topAssists = computed(() => {
    const game = this.gs.game();
    if (!game) return [];
    return game.teams.flatMap((team) => team.players.map((player) => ({ player, team })))
      .sort((a, b) => b.player.seasonStats.assists - a.player.seasonStats.assists || b.player.overall - a.player.overall).slice(0, 10);
  });

  constructor() {
    this.travel.ensureCurrent();
  }

  protected text(de: string, en: string): string { return this.i18n.locale() === 'de' ? de : en; }
  protected translate(key: string, params?: Record<string, string | number>): string { return this.i18n.t(key, params); }
  protected teamName(id: string): string { return this.gs.teamById(id)?.name ?? '—'; }
  protected teamShort(id: string): string { return this.gs.teamById(id)?.shortName ?? '—'; }
  protected selectTeam(id: string): void { this.selectedTeamId.set(id); }
  protected prevWeek(): void { this.viewWeek.update((week) => Math.max(1, week - 1)); }
  protected nextWeek(): void { this.viewWeek.update((week) => Math.min(this.gs.totalWeeks(), week + 1)); }
  protected outlinePoints(): string { return this.world()?.country.outline.map((point) => `${point.x},${point.y}`).join(' ') ?? ''; }
  protected cityFor(teamId: string) { return this.world()?.cities.find((city) => city.teamId === teamId); }
  protected cityById(cityId: string) { return this.world()?.cities.find((city) => city.id === cityId); }
  protected teamForPlayer(playerId: string) { return this.gs.game()?.teams.find((team) => team.players.some((player) => player.id === playerId)); }
  protected managerFor(teamId: string) { return this.gs.managerForTeam(teamId); }
  protected formFor(teamId: string): string[] {
    return (this.gs.game()?.league.fixtures ?? []).filter((fixture) => fixture.played && (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId)).slice(-5).map((fixture) => {
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
