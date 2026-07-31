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

  protected readonly tab = signal<'buy' | 'sell'>('buy');
  protected readonly message = signal('');

  constructor() {
    this.transfers.ensureMarket();
  }

  protected readonly market = this.transfers.market;
  protected readonly squad = computed(() => [...this.gs.squad()].sort((a, b) => b.marketValue - a.marketValue));

  protected buy(p: Player): void {
    const check = this.transfers.canBuy(p);
    if (!check.ok) {
      this.message.set(check.reason ?? 'Cannot sign player.');
      return;
    }
    if (this.transfers.buy(p)) this.message.set(`✅ Signed ${playerName(p)} for ${formatCoins(p.marketValue)} coins!`);
  }

  protected sell(p: Player): void {
    if (this.transfers.sell(p.id)) {
      this.message.set(`💸 Sold ${playerName(p)} for ${formatCoins(Math.round(p.marketValue * 0.9))} coins.`);
    } else {
      this.message.set('You cannot sell any more players — minimum squad size reached.');
    }
  }

  protected refresh(): void {
    if (this.transfers.refresh()) this.message.set('🔍 Scouted a fresh batch of players.');
    else this.message.set('Not enough coins to scout new players.');
  }
}
