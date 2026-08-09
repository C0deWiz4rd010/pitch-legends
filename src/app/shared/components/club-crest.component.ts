import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Team } from '../../models/team.model';
import { CrestEmblem } from '../../models/visual.model';
import { ClubVisualIdentity } from '../../models/visual.model';

interface Pixel { x: number; y: number }

const GLYPHS: Record<Exclude<CrestEmblem, 'initials'>, string[]> = {
  star: ['00100', '10101', '01110', '11111', '01010', '10001', '00000'],
  crown: ['10101', '11111', '10001', '11111', '01110', '00000', '00000'],
  tower: ['10101', '11111', '01110', '01110', '01010', '11111', '00000'],
  phoenix: ['10001', '11011', '01110', '11111', '01110', '01010', '10101'],
  wolf: ['10001', '11011', '11111', '10101', '01110', '01010', '00000'],
  wings: ['10001', '11011', '11111', '01110', '00100', '01010', '00000'],
  bolt: ['00110', '01100', '11110', '00110', '01100', '11000', '00000'],
  wave: ['00000', '10001', '11011', '01110', '00100', '11011', '01110'],
  mountain: ['00100', '01110', '11011', '10001', '11111', '00000', '00000'],
  sun: ['10101', '01110', '11011', '10101', '11011', '01110', '10101'],
  moon: ['01110', '11000', '10000', '10000', '11000', '01110', '00000'],
  anchor: ['00100', '01110', '00100', '10101', '11111', '01110', '00000'],
  football: ['01110', '11011', '10101', '11011', '01110', '00000', '00000'],
  flame: ['00100', '01100', '01110', '11111', '11011', '01110', '00000'],
  oak: ['00100', '11111', '01110', '11111', '00100', '01110', '00000'],
  sword: ['00100', '00100', '01110', '00100', '11111', '00100', '00000'],
  shield: ['11111', '10001', '11011', '10001', '01110', '00100', '00000'],
  comet: ['00001', '00011', '10110', '01100', '11000', '10000', '00000'],
  lion: ['10101', '11111', '01110', '11011', '01110', '10101', '00000'],
  falcon: ['10001', '11011', '01110', '11111', '00100', '01010', '00000'],
  fist: ['10101', '11111', '11111', '01110', '01110', '00100', '00000'],
  rose: ['01010', '11111', '01110', '10101', '00100', '01110', '00000'],
  gear: ['10101', '01110', '11011', '10101', '11011', '01110', '10101'],
};

@Component({
  selector: 'app-club-crest',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()', '[attr.title]': 'teamName()' },
  template: `
    <svg viewBox="0 0 32 36" role="img" [attr.aria-label]="teamName() + ' Wappen'" shape-rendering="crispEdges">
      <defs><clipPath [attr.id]="clipId()"><path [attr.d]="shapePath()" /></clipPath></defs>
      <path class="shadow" [attr.d]="shapePath()" transform="translate(2 2)" />
      <path [attr.d]="shapePath()" [attr.fill]="crest().primary" [attr.stroke]="crest().accent" [attr.stroke-width]="crest().border === 'double' ? 3 : 2" />
      <g [attr.clip-path]="'url(#' + clipId() + ')'" [attr.fill]="crest().secondary">
        @switch (crest().pattern) {
          @case ('halves') { <rect x="16" y="0" width="16" height="36" /> }
          @case ('quarters') { <rect x="0" y="0" width="16" height="18" /><rect x="16" y="18" width="16" height="18" /> }
          @case ('stripe') { <rect x="12" y="0" width="8" height="36" /> }
          @case ('hoops') { <rect x="0" y="8" width="32" height="5" /><rect x="0" y="19" width="32" height="5" /> }
          @case ('sash') { <path d="M-5 3 1-3 37 31 31 37z" /> }
          @case ('chevron') { <path d="M1 9 16 22 31 9v7L16 29 1 16z" /> }
        }
      </g>
      @if (crest().border === 'double') { <path [attr.d]="shapePath()" fill="none" [attr.stroke]="crest().secondary" stroke-width="1" transform="scale(.88) translate(2.2 2.3)" /> }
      @if (crest().border === 'riveted') {
        @for (point of rivets; track $index) { <rect [attr.x]="point.x" [attr.y]="point.y" width="1" height="1" [attr.fill]="crest().accent" /> }
      }
      @if (crest().emblem === 'initials') {
        <text x="16" y="20" text-anchor="middle" [attr.fill]="crest().accent">{{ shortName().slice(0, 3) }}</text>
      } @else {
        <g [attr.fill]="crest().accent">
          @for (pixel of glyphPixels(); track $index) { <rect [attr.x]="pixel.x" [attr.y]="pixel.y" width="2" height="2" /> }
        </g>
      }
      @if (crest().initials && crest().emblem !== 'initials') { <text x="16" y="32" text-anchor="middle" [attr.fill]="crest().accent">{{ shortName().slice(0, 3) }}</text> }
    </svg>
  `,
  styles: [`
    :host { display: inline-grid; flex: 0 0 auto; filter: drop-shadow(2px 3px 0 rgba(1,2,8,.8)); }
    svg { display: block; width: 100%; height: 100%; overflow: visible; image-rendering: pixelated; }
    .shadow { fill: #02040a; opacity: .8; }
    text { font: 5px 'Silkscreen', monospace; paint-order: stroke; stroke: #02040a; stroke-width: .7px; }
  `],
})
export class ClubCrestComponent {
  readonly team = input<Team>();
  readonly visuals = input<ClubVisualIdentity>();
  readonly clubName = input('Pitch Legends FC');
  readonly clubShort = input('PL');
  readonly size = input(64);
  protected readonly rivets = [{ x: 6, y: 7 }, { x: 25, y: 7 }, { x: 8, y: 25 }, { x: 23, y: 25 }];
  protected readonly identity = computed(() => this.team()?.visuals ?? this.visuals()!);
  protected readonly teamName = computed(() => this.team()?.name ?? this.clubName());
  protected readonly shortName = computed(() => this.team()?.shortName ?? this.clubShort());
  protected readonly crest = computed(() => this.identity().crest);
  protected readonly clipId = computed(() => `crest-${this.identity().seed.toString(36)}`);
  protected readonly shapePath = computed(() => {
    switch (this.crest().shape) {
      case 'round': return 'M16 2C7 2 3 7 3 16c0 10 6 16 13 18 7-2 13-8 13-18C29 7 25 2 16 2Z';
      case 'diamond': return 'M16 1 30 12 25 28 16 35 7 28 2 12Z';
      case 'banner': return 'M3 3h26v25l-7 7-6-4-6 4-7-7Z';
      case 'tower': return 'M4 2h5v4h4V2h6v4h4V2h5v25L16 35 4 27Z';
      case 'modern': return 'M2 4 16 1 30 4v17c0 7-7 12-14 14C9 33 2 28 2 21Z';
      default: return 'M3 3h26v17c0 8-6 13-13 16C9 33 3 28 3 20Z';
    }
  });
  protected readonly glyphPixels = computed<Pixel[]>(() => {
    const emblem = this.crest().emblem;
    if (emblem === 'initials') return [];
    const rows = GLYPHS[emblem];
    const pixels: Pixel[] = [];
    rows.forEach((row, y) => [...row].forEach((cell, x) => { if (cell === '1') pixels.push({ x: 11 + x * 2, y: 8 + y * 2 }); }));
    return pixels;
  });
}
