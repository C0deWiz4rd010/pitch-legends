import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameStateService } from '../../core/services/game-state.service';
import { PlayerDetailComponent } from '../../shared/components/player-detail.component';
import { ratingColor, moraleIcon, formatCoins } from '../../shared/rating-color';
import { PositionGroup } from '../../models/enums';
import { Player } from '../../models/player.model';

type Filter = 'ALL' | PositionGroup;
type Sort = 'overall' | 'level' | 'value' | 'position';

@Component({
  selector: 'app-squad',
  imports: [PlayerDetailComponent],
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
  protected readonly selectedId = signal<string | null>(null);

  protected readonly filters: Filter[] = ['ALL', 'GK', 'DEF', 'MID', 'ATT'];

  protected readonly players = computed<Player[]>(() => {
    const f = this.filter();
    let list = this.gs.squad().filter((p) => f === 'ALL' || p.positionGroup === f);
    const s = this.sort();
    const order: Record<PositionGroup, number> = { GK: 0, DEF: 1, MID: 2, ATT: 3 };
    list = [...list].sort((a, b) => {
      switch (s) {
        case 'level':
          return b.level - a.level || b.overall - a.overall;
        case 'value':
          return b.marketValue - a.marketValue;
        case 'position':
          return order[a.positionGroup] - order[b.positionGroup] || b.overall - a.overall;
        default:
          return b.overall - a.overall;
      }
    });
    return list;
  });

  protected readonly totalSkillPoints = computed(() =>
    this.gs.squad().reduce((s, p) => s + p.skillPoints, 0),
  );

  protected select(id: string): void {
    this.selectedId.set(id);
  }
}
