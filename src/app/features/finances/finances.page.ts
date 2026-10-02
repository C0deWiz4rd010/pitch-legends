import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';
import { financeSummary, sustainableWageBill, tierOfTeam, weeklyUpkeep } from '../../core/career/finance';
import { weeklyWageBill } from '../../core/transfer-engine';
import { EXPENSE_KINDS, FinanceKind, FinanceTotals, INCOME_KINDS, emptyFinanceTotals } from '../../models/career.model';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { formatCoins } from '../../shared/rating-color';

const LABELS: Record<FinanceKind, { de: string; en: string }> = {
  gate: { de: 'Zuschauer', en: 'Gate receipts' },
  prizes: { de: 'Prämien', en: 'Prize money' },
  tv: { de: 'TV-Gelder', en: 'TV money' },
  sponsor: { de: 'Sponsoren', en: 'Sponsors' },
  transfersIn: { de: 'Transfererlöse', en: 'Player sales' },
  wages: { de: 'Gehälter', en: 'Wages' },
  transfersOut: { de: 'Transferausgaben', en: 'Transfer spending' },
  facilities: { de: 'Anlagen-Ausbau', en: 'Facility upgrades' },
  upkeep: { de: 'Unterhalt', en: 'Upkeep' },
  other: { de: 'Sonstiges', en: 'Other' },
};

@Component({
  selector: 'app-finances',
  imports: [ClubCrestComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './finances.page.html',
  styleUrl: './finances.page.scss',
})
export class FinancesPage {
  protected readonly gs = inject(GameStateService);
  private readonly i18n = inject(I18nService);
  protected readonly formatCoins = formatCoins;

  protected readonly club = this.gs.playerTeam;
  protected readonly totals = computed<FinanceTotals>(() => this.club()?.finance?.totals ?? emptyFinanceTotals());
  protected readonly previous = computed(() => this.club()?.finance?.previous ?? null);
  protected readonly summary = computed(() => { const club = this.club(); return club ? financeSummary(club) : { income: 0, expenses: 0, net: 0 }; });
  protected readonly wageBill = computed(() => { const game = this.gs.game(); return game ? weeklyWageBill(game, game.clubId) : 0; });
  protected readonly wageCap = computed(() => {
    const game = this.gs.game(), club = this.club();
    return game && club ? sustainableWageBill(club, tierOfTeam(game, club.id)) : 0;
  });
  protected readonly upkeep = computed(() => { const club = this.club(); return club ? weeklyUpkeep(club) : 0; });
  protected readonly rows = computed(() => {
    const totals = this.totals(), previous = this.previous();
    const row = (kind: FinanceKind) => ({ kind, label: this.text(LABELS[kind].de, LABELS[kind].en), value: totals[kind], previous: previous?.[kind] ?? null });
    return { income: INCOME_KINDS.map(row), expenses: EXPENSE_KINDS.map(row), other: row('other') };
  });
  /** Balance line for the SVG chart (week index → coins). */
  protected readonly chart = computed(() => {
    const balance = this.club()?.finance?.balance ?? [];
    if (balance.length < 2) return null;
    const max = Math.max(...balance), min = Math.min(...balance, 0);
    const span = Math.max(1, max - min);
    const points = balance.map((value, index) => `${Math.round(index / (balance.length - 1) * 600)},${Math.round(160 - (value - min) / span * 150)}`).join(' ');
    return { points, max, min, last: balance[balance.length - 1] };
  });
  protected readonly comparison = computed(() => {
    const game = this.gs.game();
    if (!game) return [];
    return this.gs.leagueTeams().map((team) => ({ team, coins: team.coins, wages: weeklyWageBill(game, team.id), net: financeSummary(team).net }))
      .sort((a, b) => b.coins - a.coins);
  });

  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }
  protected signed(value: number): string { return `${value >= 0 ? '+' : '−'}${formatCoins(Math.abs(value))}`; }
}
