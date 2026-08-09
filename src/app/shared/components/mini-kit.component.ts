import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { KitDesign } from '../../models/visual.model';

@Component({
  selector: 'app-mini-kit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    <svg viewBox="0 0 32 36" role="img" [attr.aria-label]="label()" shape-rendering="crispEdges">
      <path d="M8 3h16l7 6-5 7-3-3v20H9V13l-3 3-5-7z" [attr.fill]="kit().shirt" stroke="#02040a" stroke-width="2" />
      <g [attr.fill]="kit().secondary">
        @switch (kit().pattern) {
          @case ('halves') { <path d="M16 4h8l6 5-4 5-3-2v20h-7z" /> }
          @case ('stripes') { <path d="M11 4h4v28h-4zm8 0h4v28h-4z" /> }
          @case ('hoops') { <path d="M6 12h20v5H6zm3 10h14v5H9z" /> }
          @case ('sash') { <path d="m7 6 4-2 14 23-2 6h-3z" /> }
          @case ('chest-band') { <path d="M5 13h22v6H5z" /> }
          @case ('pinstripes') { <path d="M11 4h2v28h-2zm5 0h2v28h-2zm5 0h2v28h-2z" /> }
          @case ('chevron') { <path d="M6 11 16 19l10-8v5l-10 8-10-8z" /> }
        }
      </g>
      <path d="M9 26h14v7H9z" [attr.fill]="kit().shorts" />
      <path d="M9 3h14v3H9z" [attr.fill]="kit().trim" />
      <text x="16" y="22" text-anchor="middle" [attr.fill]="kit().number">{{ number() }}</text>
    </svg>
  `,
  styles: [`
    :host { display: inline-grid; flex: 0 0 auto; filter: drop-shadow(2px 2px 0 #02040a); }
    svg { width: 100%; height: 100%; image-rendering: pixelated; }
    text { font: 6px 'Silkscreen', monospace; paint-order: stroke; stroke: rgba(2,4,10,.8); stroke-width: .6px; }
  `],
})
export class MiniKitComponent {
  readonly kit = input.required<KitDesign>();
  readonly size = input(52);
  readonly number = input('');
  readonly label = input('Vereinstrikot');
}
