import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameStateService } from '../../core/services/game-state.service';
import { playerName } from '../../core/ratings';
import { Fixture } from '../../models/league.model';

@Component({
  selector: 'app-league',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './league.page.html',
  styleUrl: './league.page.scss',
})
export class LeaguePage {
  protected readonly gs = inject(GameStateService);
  protected readonly playerName = playerName;

  protected readonly tab = signal<'table' | 'fixtures' | 'scorers'>('table');
  protected readonly viewWeek = signal(this.gs.currentWeek());

  protected readonly clubId = computed(() => this.gs.playerTeam()?.id);

  protected readonly weekFixtures = computed<Fixture[]>(() => {
    const g = this.gs.game();
    if (!g) return [];
    return g.league.fixtures.filter((f) => f.week === this.viewWeek());
  });

  protected teamName(id: string): string {
    return this.gs.teamById(id)?.name ?? '—';
  }
  protected teamShort(id: string): string {
    return this.gs.teamById(id)?.shortName ?? '—';
  }

  protected prevWeek(): void {
    this.viewWeek.update((w) => Math.max(1, w - 1));
  }
  protected nextWeek(): void {
    this.viewWeek.update((w) => Math.min(this.gs.totalWeeks(), w + 1));
  }
}
