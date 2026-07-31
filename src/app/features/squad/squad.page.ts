import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GameStateService } from '../../core/services/game-state.service';
import { PlayerDetailComponent } from '../../shared/components/player-detail.component';
import { ratingColor, moraleIcon, formatCoins } from '../../shared/rating-color';
import { PositionGroup } from '../../models/enums';
import { Player } from '../../models/player.model';

type Filter = 'ALL' | PositionGroup;
type Sort = 'overall' | 'level' | 'value' | 'position' | 'potential';

@Component({
  selector: 'app-squad',
  imports: [PlayerDetailComponent, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './squad.page.html',
  styleUrl: './squad.page.scss',
})
export class SquadPage {
  protected readonly gs = inject(GameStateService);
  protected readonly ratingColor = ratingColor;
  protected readonly moraleIcon = moraleIcon;
  protected readonly formatCoins = formatCoins;

  protected readonly filter = signal<Filter>('ALL');
  protected readonly sort = signal<Sort>('overall');
  protected readonly search = signal('');
  protected readonly selectedId = signal<string | null>(null);

  protected readonly filters: { key: Filter; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'GK', label: 'Keepers' },
    { key: 'DEF', label: 'Defence' },
    { key: 'MID', label: 'Midfield' },
    { key: 'ATT', label: 'Attack' },
  ];

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
    this.selectedId.set(id);
  }
}
