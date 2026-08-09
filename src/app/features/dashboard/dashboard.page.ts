import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { formatCoins, ratingColor, moraleIcon } from '../../shared/rating-color';
import { playerName } from '../../core/ratings';
import { Player } from '../../models/player.model';
import { I18nService } from '../../core/services/i18n.service';
import { CareerObjective } from '../../models/game.model';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
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

  protected readonly rank = computed(() => {
    const team = this.gs.playerTeam();
    if (!team) return 0;
    return this.gs.standings().findIndex((r) => r.teamId === team.id) + 1;
  });

  protected readonly totalTeams = computed(() => this.gs.game()?.teams.length ?? 0);

  protected readonly squadRating = computed(() => this.teamRating(this.gs.squad()));

  private teamRating(players: Player[]): number {
    if (!players.length) return 0;
    const top = [...players].sort((a, b) => b.overall - a.overall).slice(0, 11);
    return Math.round(top.reduce((s, p) => s + p.overall, 0) / top.length);
  }

  protected readonly seasonProgress = computed(() => {
    const total = this.gs.totalWeeks();
    if (!total) return 0;
    return Math.min(100, Math.round(((this.gs.currentWeek() - 1) / total) * 100));
  });

  protected readonly avgMorale = computed(() => {
    const squad = this.gs.squad();
    if (!squad.length) return 0;
    return Math.round(squad.reduce((s, p) => s + p.morale, 0) / squad.length);
  });

  protected readonly form = computed<('W' | 'D' | 'L')[]>(() => {
    const g = this.gs.game();
    const team = this.gs.playerTeam();
    if (!g || !team) return [];
    return g.league.fixtures
      .filter((f) => f.played && (f.homeTeamId === team.id || f.awayTeamId === team.id))
      .sort((a, b) => a.week - b.week)
      .slice(-5)
      .map((f) => {
        const gf = f.homeTeamId === team.id ? f.homeScore! : f.awayScore!;
        const ga = f.homeTeamId === team.id ? f.awayScore! : f.homeScore!;
        return gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      });
  });

  protected readonly nextOpponent = computed(() => {
    const fx = this.gs.nextFixture();
    const team = this.gs.playerTeam();
    if (!fx || !team) return null;
    const oppId = fx.homeTeamId === team.id ? fx.awayTeamId : fx.homeTeamId;
    const opp = this.gs.teamById(oppId);
    if (!opp) return null;
    return {
      name: opp.name,
      short: opp.shortName,
      color: opp.kit.primary,
      secondary: opp.kit.secondary,
      home: fx.homeTeamId === team.id,
      rating: this.teamRating(opp.players),
    };
  });

  protected readonly starPlayer = computed<Player | null>(() => {
    const squad = this.gs.squad();
    if (!squad.length) return null;
    return [...squad].sort((a, b) => b.overall + b.form * 1.5 - (a.overall + a.form * 1.5))[0];
  });

  protected readonly injuredCount = computed(
    () => this.gs.squad().filter((p) => p.injuryWeeks > 0).length,
  );

  protected readonly skillPointsAvailable = computed(() =>
    this.gs.squad().reduce((s, p) => s + p.skillPoints, 0),
  );

  protected rankSuffix(n: number): string {
    return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  }

  protected objectiveLabel(objective: CareerObjective): string {
    const de = this.gs.game()?.settings.locale === 'de';
    if (objective.type === 'league-position') return de ? `Liga-Platz ${objective.target} erreichen` : `Finish in league position ${objective.target}`;
    if (objective.type === 'player-growth') return de ? `${objective.target} Spieler-Level gewinnen` : `Gain ${objective.target} player levels`;
    return de ? `${objective.target} Siege holen` : `Win ${objective.target} matches`;
  }

  protected objectiveProgress(objective: CareerObjective): number {
    if (objective.type === 'league-position') return objective.completed ? 100 : Math.max(5, 100 - (this.rank() - objective.target) * 14);
    return Math.min(100, Math.round(objective.progress / objective.target * 100));
  }
}
