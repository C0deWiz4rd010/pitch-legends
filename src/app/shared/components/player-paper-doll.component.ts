import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Player } from '../../models/player.model';
import { KitDesign } from '../../models/visual.model';
import { PortraitService } from '../../core/services/portrait.service';

@Component({
  selector: 'app-player-paper-doll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    @if (src()) { <img [src]="src()" [alt]="player().firstName + ' ' + player().lastName + ' 3D-Spieler'" /> }
  `,
  styles: [`
    :host { display: inline-grid; image-rendering: auto; }
    img { width:100%; height:100%; object-fit:contain; image-rendering:auto; transform-origin:50% 100%;  }
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
    effect((onCleanup) => {
      let active = true;
      onCleanup(() => { active = false; });
      const player = this.player();
      const kit = this.kit();
      void this.portraits.figure(player, kit).then((src) => {
        if (active && this.player().id === player.id) this.src.set(src);
      });
    });
  }
}
