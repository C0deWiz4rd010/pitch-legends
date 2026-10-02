import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GameStateService } from '../../core/services/game-state.service';
import { PlayerDetailComponent } from '../../shared/components/player-detail.component';
import { ratingColor, moraleIcon, formatCoins } from '../../shared/rating-color';
import { PositionGroup } from '../../models/enums';
import { Player } from '../../models/player.model';
import { PlayerPortraitComponent } from '../../shared/components/player-portrait.component';
import { RadarChartComponent } from '../../shared/components/radar-chart.component';
import { I18nService } from '../../core/services/i18n.service';
import { ATTRIBUTE_KEYS } from '../../models/enums';

type Filter = 'ALL' | PositionGroup;
type Sort = 'overall' | 'level' | 'value' | 'position' | 'potential';

@Component({
  selector: 'app-squad',
  imports: [PlayerDetailComponent, FormsModule, PlayerPortraitComponent, RadarChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './squad.page.html',
  styleUrl: './squad.page.scss',
})
export class SquadPage {
  protected readonly gs = inject(GameStateService);
  protected readonly i18n = inject(I18nService);
  protected readonly ratingColor = ratingColor;
  protected readonly moraleIcon = moraleIcon;
  protected readonly formatCoins = formatCoins;

  protected readonly filter = signal<Filter>('ALL');
  protected readonly sort = signal<Sort>('overall');
  protected readonly search = signal('');
  protected readonly selectedId = signal<string | null>(null);

  protected readonly filters: { key: Filter; de: string; en: string }[] = [
    { key: 'ALL', de: 'Alle', en: 'All' },
    { key: 'GK', de: 'Torhüter', en: 'Keepers' },
    { key: 'DEF', de: 'Abwehr', en: 'Defence' },
    { key: 'MID', de: 'Mittelfeld', en: 'Midfield' },
    { key: 'ATT', de: 'Angriff', en: 'Attack' },
  ];
  protected readonly sorts: { key: Sort; de: string; en: string }[] = [
    { key: 'overall', de: 'Stärke', en: 'Overall' },
    { key: 'potential', de: 'Potenzial', en: 'Potential' },
    { key: 'level', de: 'Level', en: 'Level' },
    { key: 'value', de: 'Marktwert', en: 'Value' },
    { key: 'position', de: 'Position', en: 'Position' },
  ];
  protected readonly comparing = signal(false);
  protected readonly compareIds = signal<string[]>([]);
  protected readonly compared = computed(() => this.compareIds().map(id => this.gs.squad().find(player => player.id === id)).filter((player): player is Player => !!player));
  protected readonly compareRows = computed(() => {
    const [a, b] = this.compared();
    if (!a || !b) return [];
    const labels: Record<string, [string, string]> = { pace: ['Tempo', 'Pace'], shooting: ['Schuss', 'Shooting'], passing: ['Passen', 'Passing'], dribbling: ['Dribbling', 'Dribbling'], defending: ['Verteidigung', 'Defending'], physical: ['Physis', 'Physical'], stamina: ['Ausdauer', 'Stamina'], goalkeeping: ['Torwart', 'Goalkeeping'] };
    return [
      ...ATTRIBUTE_KEYS.map(key => ({ key, label: this.i18n.pick(...labels[key]), a: a.attributes[key], b: b.attributes[key] })),
      { key: 'overall', label: this.i18n.pick('Gesamt', 'Overall'), a: a.overall, b: b.overall },
      { key: 'potential', label: this.i18n.pick('Potenzial', 'Potential'), a: a.potential, b: b.potential },
      { key: 'goals', label: this.i18n.pick('Saisontore', 'Season goals'), a: a.seasonStats.goals, b: b.seasonStats.goals },
    ];
  });
  protected readonly wageBill = computed(() => this.gs.squad().reduce((sum, player) => sum + player.salary, 0));

  protected readonly counts = computed<Record<Filter, number>>(() => {
    const squad = this.gs.squad();
    return {
      ALL: squad.length,
      GK: squad.filter((p) => p.positionGroup === 'GK').length,
      DEF: squad.filter((p) => p.positionGroup === 'DEF').length,
      MID: squad.filter((p) => p.positionGroup === 'MID').length,
      ATT: squad.filter((p) => p.positionGroup === 'ATT').length,
    };
  });

  protected readonly players = computed<Player[]>(() => {
    const f = this.filter();
    const q = this.search().trim().toLowerCase();
    let list = this.gs.squad().filter((p) => f === 'ALL' || p.positionGroup === f);
    if (q) {
      list = list.filter((p) =>
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) || p.position.toLowerCase().includes(q),
      );
    }
    const s = this.sort();
    const order: Record<PositionGroup, number> = { GK: 0, DEF: 1, MID: 2, ATT: 3 };
    return [...list].sort((a, b) => {
      switch (s) {
        case 'level':
          return b.level - a.level || b.overall - a.overall;
        case 'value':
          return b.marketValue - a.marketValue;
        case 'potential':
          return b.potential - a.potential || b.overall - a.overall;
        case 'position':
          return order[a.positionGroup] - order[b.positionGroup] || b.overall - a.overall;
        default:
          return b.overall - a.overall;
      }
    });
  });

  protected readonly squadRating = computed(() => {
    const top = [...this.gs.squad()].sort((a, b) => b.overall - a.overall).slice(0, 11);
    return top.length ? Math.round(top.reduce((s, p) => s + p.overall, 0) / top.length) : 0;
  });

  protected readonly totalSkillPoints = computed(() =>
    this.gs.squad().reduce((s, p) => s + p.skillPoints, 0),
  );

  protected xpPercent(p: Player): number {
    return Math.min(100, Math.round((p.xp / p.xpToNext) * 100));
  }

  protected select(id: string): void {
    if (!this.comparing()) { this.selectedId.set(id); return; }
    // Comparison keeps the two most recent picks; clicking a picked player removes it.
    this.compareIds.update(ids => ids.includes(id) ? ids.filter(other => other !== id) : [...ids, id].slice(-2));
  }

  protected toggleCompare(): void {
    this.comparing.update(value => !value);
    this.compareIds.set([]);
  }

  protected averageRating(player: Player): string {
    return player.seasonStats.appearances ? (player.seasonStats.ratingSum / player.seasonStats.appearances).toFixed(1) : '–';
  }

  protected contractLabel(player: Player): string {
    const weeks = player.contractWeeks;
    if (weeks >= 38) return this.i18n.pick(`${Math.round(weeks / 38 * 10) / 10} J.`, `${Math.round(weeks / 38 * 10) / 10} yrs`);
    return this.i18n.pick(`${weeks} Wo.`, `${weeks} wks`);
  }
}
