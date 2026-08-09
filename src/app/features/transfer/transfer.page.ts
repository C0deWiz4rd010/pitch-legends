import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameStateService } from '../../core/services/game-state.service';
import { TransferService, MAX_SQUAD_SIZE } from '../../core/services/transfer.service';
import { ratingColor, formatCoins } from '../../shared/rating-color';
import { playerName } from '../../core/ratings';
import { Player } from '../../models/player.model';

@Component({
  selector: 'app-transfer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transfer.page.html',
  styleUrl: './transfer.page.scss',
})
export class TransferPage {
  protected readonly gs = inject(GameStateService);
  protected readonly transfers = inject(TransferService);
  protected readonly ratingColor = ratingColor;
  protected readonly formatCoins = formatCoins;
  protected readonly playerName = playerName;
  protected readonly maxSquad = MAX_SQUAD_SIZE;

  protected readonly tab = signal<'buy' | 'sell' | 'contracts'>('buy');
  protected readonly message = signal('');
  protected readonly search = signal('');
  protected readonly positionFilter = signal('ALL');
  protected readonly positions = ['ALL', 'GK', 'DEF', 'MID', 'ATT'];

  constructor() {
    this.transfers.ensureMarket();
  }

  protected readonly market = this.transfers.market;
  protected readonly squad = computed(() => [...this.gs.squad()].sort((a, b) => b.marketValue - a.marketValue));
  protected readonly filteredMarket = computed(() => {
    const query = this.search().trim().toLowerCase();
    const group = this.positionFilter();
    return this.market().filter((player) =>
      (group === 'ALL' || player.positionGroup === group) &&
      (!query || playerName(player).toLowerCase().includes(query) || player.position.toLowerCase().includes(query)),
    );
  });
  protected readonly contracts = computed(() => [...this.gs.squad()].sort((a, b) => a.contractWeeks - b.contractWeeks));
  protected readonly wages = computed(() => this.gs.squad().reduce((sum, player) => sum + player.salary, 0));

  protected buy(p: Player): void {
    const check = this.transfers.canBuy(p);
    if (!check.ok) {
      this.message.set(check.reason ?? 'Cannot sign player.');
      return;
    }
    if (this.transfers.buy(p)) this.message.set(`SIGNED: ${playerName(p)} for ${formatCoins(p.marketValue)} coins.`);
  }

  protected sell(p: Player): void {
    if (this.transfers.sell(p.id)) {
      this.message.set(`SOLD: ${playerName(p)} for ${formatCoins(Math.round(p.marketValue * 0.9))} coins.`);
    } else {
      this.message.set('You cannot sell any more players — minimum squad size reached.');
    }
  }

  protected refresh(): void {
    if (this.transfers.refresh()) this.message.set('SCOUTING: fresh player reports received.');
    else this.message.set('Not enough coins to scout new players.');
  }

  protected estimatedRating(player: Player): string {
    const rank = this.gs.manager()?.perks.scouting ?? 0;
    const uncertainty = Math.max(0, 5 - rank);
    return uncertainty ? `${Math.max(1, player.overall - uncertainty)}–${Math.min(99, player.overall + uncertainty)}` : String(player.overall);
  }

  protected renew(player: Player): void {
    if (this.transfers.renew(player.id)) this.message.set(`CONTRACT: ${playerName(player)} +104 weeks.`);
    else this.message.set('Renewal failed: check coins and wage budget.');
  }
}
