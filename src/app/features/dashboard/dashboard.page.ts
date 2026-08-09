import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { createClubVisualIdentity, hash32 } from '../../core/visual-identity';
import { playerName } from '../../core/ratings';
import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { CareerObjective } from '../../models/game.model';
import { I18nService } from '../../core/services/i18n.service';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { MiniKitComponent } from '../../shared/components/mini-kit.component';
import { PlayerPortraitComponent } from '../../shared/components/player-portrait.component';
import { ManagerPortraitComponent } from '../../shared/components/manager-portrait.component';
import { formatCoins, moraleIcon, ratingColor } from '../../shared/rating-color';

interface ManagerAlert {
  icon: string;
  label: string;
  route: string;
  tone: 'danger' | 'warning' | 'info';
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, ClubCrestComponent, MiniKitComponent, PlayerPortraitComponent, ManagerPortraitComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage {
  protected readonly gs = inject(GameStateService);
  protected readonly i18n = inject(I18nService);
  protected readonly playerName = playerName;
  protected readonly formatCoins = formatCoins;
  protected readonly ratingColor = ratingColor;
  protected readonly moraleIcon = moraleIcon;
  protected readonly newsIndex = signal(0);
  protected readonly studioOpen = signal(false);
  private readonly studioNonce = signal(0);

  protected readonly rank = computed(() => {
    const team = this.gs.playerTeam();
    return team ? this.gs.standings().findIndex((row) => row.teamId === team.id) + 1 : 0;
  });

  protected readonly squadRating = computed(() => this.teamRating(this.gs.squad()));
  protected readonly avgMorale = computed(() => average(this.gs.squad().map((player) => player.morale)));
  protected readonly avgFitness = computed(() => average(this.gs.squad().map((player) => player.fitness)));
  protected readonly skillPointsAvailable = computed(() => this.gs.squad().reduce((total, player) => total + player.skillPoints, 0));

  protected readonly form = computed<('W' | 'D' | 'L')[]>(() => this.formFor(this.gs.playerTeam()?.id ?? ''));

  protected readonly nextOpponent = computed(() => {
    const fixture = this.gs.nextFixture();
    const team = this.gs.playerTeam();
    if (!fixture || !team) return null;
    const opponent = this.gs.teamById(fixture.homeTeamId === team.id ? fixture.awayTeamId : fixture.homeTeamId);
    if (!opponent) return null;
    return {
      fixture,
      team: opponent,
      home: fixture.homeTeamId === team.id,
      rating: this.teamRating(opponent.players),
      rank: this.gs.standings().findIndex((row) => row.teamId === opponent.id) + 1,
      form: this.formFor(opponent.id),
      weather: (['clear', 'rain', 'storm'] as const)[hash32(`${fixture.id}|weather`) % 3],
    };
  });

  protected readonly starPlayer = computed<Player | null>(() => {
    const squad = this.gs.squad();
    return squad.length ? [...squad].sort((a, b) => b.overall + b.form * 1.5 - (a.overall + a.form * 1.5))[0] : null;
  });

  protected readonly alerts = computed<ManagerAlert[]>(() => {
    const alerts: ManagerAlert[] = [];
    const injured = this.gs.squad().filter((player) => player.injuryWeeks > 0).length;
    const expiring = this.gs.squad().filter((player) => player.contractWeeks <= 12).length;
    const formationIds = new Set(this.gs.playerTeam()?.formation.slots.map((slot) => slot.playerId).filter(Boolean));
    const invalidStarters = this.gs.squad().filter((player) => formationIds.has(player.id) && player.injuryWeeks > 0).length;
    if (invalidStarters) alerts.push({ icon: '!', label: this.text(`${invalidStarters} verletzte Starter ersetzen`, `Replace ${invalidStarters} injured starters`), route: '/tactics', tone: 'danger' });
    else if (injured) alerts.push({ icon: '+', label: this.text(`${injured} Verletzte im Kader`, `${injured} players injured`), route: '/squad', tone: 'warning' });
    if (expiring) alerts.push({ icon: '⌛', label: this.text(`${expiring} Verträge laufen bald aus`, `${expiring} contracts expiring`), route: '/transfer', tone: 'warning' });
    if (this.gs.trainingSlotsRemaining() > 0) alerts.push({ icon: 'XP', label: this.text(`${this.gs.trainingSlotsRemaining()} Trainingsplätze frei`, `${this.gs.trainingSlotsRemaining()} training slots open`), route: '/training', tone: 'info' });
    if (this.skillPointsAvailable() > 0) alerts.push({ icon: 'SP', label: this.text(`${this.skillPointsAvailable()} Skillpunkte verteilen`, `Spend ${this.skillPointsAvailable()} skill points`), route: '/squad', tone: 'info' });
    return alerts.slice(0, 3);
  });

  protected readonly tableWindow = computed(() => {
    const rows = this.gs.standings();
    const own = rows.findIndex((row) => row.teamId === this.gs.playerTeam()?.id);
    const start = Math.max(0, Math.min(rows.length - 5, own - 2));
    return rows.slice(start, start + 5);
  });

  protected readonly activeNews = computed(() => {
    const news = this.gs.news();
    if (!news.length) return null;
    return news[this.newsIndex() % news.length];
  });

  protected nextNews(direction: number): void {
    const length = this.gs.news().length;
    if (length) this.newsIndex.update((index) => (index + direction + length) % length);
  }

  protected rollClubVisuals(): void {
    const team = this.gs.playerTeam();
    if (!team) return;
    const nonce = this.studioNonce() + 1;
    this.studioNonce.set(nonce);
    const visuals = createClubVisualIdentity(team.name, team.shortName, team.kit.primary, team.kit.secondary, hash32(`${team.visuals.seed}|studio|${nonce}`));
    this.gs.mutate((draft) => {
      const club = draft.teams.find((candidate) => candidate.id === draft.clubId);
      if (club) club.visuals = visuals;
    });
  }

  protected teamById(id: string): Team | undefined {
    return this.gs.teamById(id);
  }

  protected text(de: string, en: string): string {
    return this.i18n.locale() === 'de' ? de : en;
  }

  protected weatherLabel(weather: 'clear' | 'rain' | 'storm'): string {
    const labels = {
      clear: this.text('Klar', 'Clear'),
      rain: this.text('Regen', 'Rain'),
      storm: this.text('Sturm', 'Storm'),
    };
    return labels[weather];
  }

  protected objectiveLabel(objective: CareerObjective): string {
    if (objective.type === 'league-position') return this.text(`Liga-Platz ${objective.target} erreichen`, `Finish in league position ${objective.target}`);
    if (objective.type === 'player-growth') return this.text(`${objective.target} Spieler-Level gewinnen`, `Gain ${objective.target} player levels`);
    return this.text(`${objective.target} Siege holen`, `Win ${objective.target} matches`);
  }

  protected objectiveProgress(objective: CareerObjective): number {
    if (objective.type === 'league-position') {
      const progress = objective.completed ? 100 : 100 - (this.rank() - objective.target) * 14;
      return Math.min(100, Math.max(5, progress));
    }
    return Math.min(100, Math.round(objective.progress / objective.target * 100));
  }

  private teamRating(players: Player[]): number {
    const top = [...players].sort((a, b) => b.overall - a.overall).slice(0, 11);
    return top.length ? Math.round(top.reduce((total, player) => total + player.overall, 0) / top.length) : 0;
  }

  private formFor(teamId: string): ('W' | 'D' | 'L')[] {
    const game = this.gs.game();
    if (!game || !teamId) return [];
    return game.league.fixtures
      .filter((fixture) => fixture.played && (fixture.homeTeamId === teamId || fixture.awayTeamId === teamId))
      .sort((a, b) => a.week - b.week)
      .slice(-5)
      .map((fixture) => {
        const goalsFor = fixture.homeTeamId === teamId ? fixture.homeScore! : fixture.awayScore!;
        const goalsAgainst = fixture.homeTeamId === teamId ? fixture.awayScore! : fixture.homeScore!;
        return goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
      });
  }
}

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}
