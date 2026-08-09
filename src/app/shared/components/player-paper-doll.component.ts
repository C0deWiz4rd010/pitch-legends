import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Player } from '../../models/player.model';
import { KitDesign } from '../../models/visual.model';
import { PortraitService } from '../../core/services/portrait.service';

@Component({
  selector: 'app-player-paper-doll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    @if (src()) { <img [src]="src()" [alt]="player().firstName + ' ' + player().lastName + ' Pixel-Spieler'" /> }
  `,
  styles: [`
    :host { display: inline-grid; image-rendering: pixelated; }
    img { width:100%; height:100%; object-fit:contain; image-rendering:pixelated; transform-origin:50% 100%; animation:doll-idle 1.25s steps(3) infinite; }
    @keyframes doll-idle { 50% { transform:translateY(-1px); } }
    @media(prefers-reduced-motion:reduce){ img { animation:none; } }
  `],
})
export class PlayerPaperDollComponent {
  private readonly portraits = inject(PortraitService);
  readonly player = input.required<Player>();
  readonly kit = input.required<KitDesign>();
  readonly size = input(96);
  protected readonly src = signal('');

  constructor() {
    effect(() => {
      const player = this.player();
      const kit = this.kit();
      void this.portraits.figure(player, kit).then((src) => {
        if (this.player().id === player.id) this.src.set(src);
      });
    });
  }
}
