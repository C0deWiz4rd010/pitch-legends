import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Player } from '../../models/player.model';
import { Team } from '../../models/team.model';
import { PortraitService } from '../../core/services/portrait.service';
import { GameStateService } from '../../core/services/game-state.service';

@Component({
  selector: 'app-player-portrait',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    @if (src()) {
      <img [src]="src()" [alt]="player().firstName + ' ' + player().lastName" />
    } @else {
      <span class="loading" aria-hidden="true"></span>
    }
  `,
  styles: [`
    :host { display: inline-grid; overflow: hidden; flex: 0 0 auto; border: 2px solid var(--border); background: var(--bg-900); box-shadow: 3px 3px 0 #02040a; }
    img { width: 100%; height: 100%; object-fit: cover; image-rendering: auto; }
    .loading { width: 100%; height: 100%; background: repeating-linear-gradient(135deg, var(--surface), var(--surface) 6px, var(--surface-2) 6px, var(--surface-2) 12px); animation: pulse 900ms steps(2) infinite; }
    @keyframes pulse { 50% { opacity: .55; } }
    @media (prefers-reduced-motion: reduce) { .loading { animation: none; } }
  `],
})
export class PlayerPortraitComponent {
  private readonly portraits = inject(PortraitService);
  private readonly gameState = inject(GameStateService);
  readonly player = input.required<Player>();
  readonly team = input<Team>();
  readonly size = input(64);
  protected readonly src = signal('');

  constructor() {
    effect((onCleanup) => {
      let active = true;
      onCleanup(() => { active = false; });
      const player = this.player();
      const team = this.team() ?? this.gameState.game()?.teams.find((candidate) => candidate.players.some((member) => member.id === player.id));
      this.src.set('');
      void this.portraits.portrait(player, team).then((src) => {
        if (active && this.player().id === player.id) this.src.set(src);
      });
    });
  }
}
