import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { formatCoins } from '../../shared/rating-color';
import { playerName } from '../../core/ratings';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage {
  protected readonly gs = inject(GameStateService);
  protected readonly playerName = playerName;
  protected readonly formatCoins = formatCoins;

  protected readonly rank = computed(() => {
    const team = this.gs.playerTeam();
    if (!team) return 0;
    return this.gs.standings().findIndex((r) => r.teamId === team.id) + 1;
  });

  protected readonly squadRating = computed(() => {
    const squad = this.gs.squad();
    if (!squad.length) return 0;
    const top = [...squad].sort((a, b) => b.overall - a.overall).slice(0, 11);
    return Math.round(top.reduce((s, p) => s + p.overall, 0) / top.length);
  });

  protected readonly nextOpponent = computed(() => {
    const fx = this.gs.nextFixture();
    const team = this.gs.playerTeam();
    if (!fx || !team) return null;
    const oppId = fx.homeTeamId === team.id ? fx.awayTeamId : fx.homeTeamId;
    const opp = this.gs.teamById(oppId);
    return opp ? { name: opp.name, short: opp.shortName, home: fx.homeTeamId === team.id } : null;
  });

  protected readonly injuredCount = computed(
    () => this.gs.squad().filter((p) => p.injuryWeeks > 0).length,
  );

  protected readonly skillPointsAvailable = computed(() =>
    this.gs.squad().reduce((s, p) => s + p.skillPoints, 0),
  );
}
