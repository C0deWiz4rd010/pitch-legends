import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Player } from '../../models/player.model';
import { KitDesign } from '../../models/visual.model';
import { contrastText } from '../../core/visual-identity';

const SKIN = ['#f5d0a9', '#e9b989', '#d99a68', '#bf7b50', '#9b5c3d', '#75422f', '#573126', '#35221f'];
const HAIR = ['#17141d', '#2c1b18', '#4b2e24', '#71462b', '#9b673d', '#c89b62', '#d9c6a2', '#702c32'];

@Component({
  selector: 'app-player-paper-doll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    <svg viewBox="0 0 32 44" role="img" [attr.aria-label]="player().firstName + ' ' + player().lastName + ' Pixel-Spieler'" shape-rendering="crispEdges">
      <ellipse cx="16" cy="41" rx="10" ry="2" fill="rgba(2,4,10,.55)" />
      <g class="doll">
        <path d="M9 24h6v13H8v-4h2z" [attr.fill]="kit().shorts" stroke="#050713" stroke-width="2" />
        <path d="M17 24h6l1 9v4h-7z" [attr.fill]="kit().shorts" stroke="#050713" stroke-width="2" />
        <path d="M8 34h7v5H8zM17 34h7v5h-7z" [attr.fill]="kit().socks" stroke="#050713" stroke-width="1" />
        <path d="M6 38h9v3H6zM17 38h10v3H17z" [attr.fill]="player().visuals.bootColor" stroke="#050713" stroke-width="1" />
        <path d="M7 13h18v14H7z" [attr.fill]="kit().shirt" stroke="#050713" stroke-width="2" />
        <g [attr.fill]="kit().secondary">
          @switch (kit().pattern) {
            @case ('halves') { <path d="M16 13h9v14h-9z" /> }
            @case ('stripes') { <path d="M10 13h3v14h-3zm6 0h3v14h-3zm6 0h3v14h-3z" /> }
            @case ('hoops') { <path d="M7 16h18v3H7zm0 5h18v3H7z" /> }
            @case ('sash') { <path d="m8 13 4 0 12 14h-5z" /> }
            @case ('chest-band') { <path d="M7 17h18v5H7z" /> }
            @case ('pinstripes') { <path d="M10 13h1v14h-1zm4 0h1v14h-1zm4 0h1v14h-1zm4 0h1v14h-1z" /> }
            @case ('chevron') { <path d="m7 16 9 7 9-7v4l-9 7-9-7z" /> }
          }
        </g>
        <path d="M7 14 2 18v9h5v-8l3-2zM25 14l5 4v9h-5v-8l-3-2z" [attr.fill]="player().visuals.longSleeves ? kit().shirt : skin()" stroke="#050713" stroke-width="2" />
        @if (player().visuals.wristTape === 'left' || player().visuals.wristTape === 'both') { <path d="M2 23h5v2H2z" fill="#f4f4df" /> }
        @if (player().visuals.wristTape === 'right' || player().visuals.wristTape === 'both') { <path d="M25 23h5v2h-5z" fill="#f4f4df" /> }
        <path d="M11 3h10v11H11z" [attr.fill]="skin()" stroke="#050713" stroke-width="2" />
        <path [attr.d]="hairPath()" [attr.fill]="hair()" />
        <path d="M13 8h2v1h-2zm5 0h2v1h-2z" fill="#17141d" />
        @if (player().visuals.facialHair > 0) { <path d="M13 11h7v3h-7z" [attr.fill]="hair()" /> }
        @if (player().visuals.headAccessory === 'headband') { <path d="M11 6h10v2H11z" fill="#f4f4df" /> }
        @if (player().visuals.headAccessory === 'protective-cap') { <path d="M10 2h12v6H10z" fill="#172144" stroke="#050713" stroke-width="1" /> }
        <text x="16" y="23" text-anchor="middle" [attr.fill]="numberColor()">{{ player().kitNumber }}</text>
      </g>
    </svg>
  `,
  styles: [`
    :host { display: inline-grid; image-rendering: pixelated; }
    svg { width:100%; height:100%; overflow:visible; image-rendering:pixelated; }
    text { font: 6px Silkscreen, monospace; paint-order:stroke; stroke:#050713; stroke-width:.5px; }
    .doll { transform-origin:16px 41px; animation:doll-idle 1.25s steps(3) infinite; }
    @keyframes doll-idle { 50% { transform:translateY(-1px) rotate(-1deg); } }
    @media(prefers-reduced-motion:reduce){ .doll { animation:none; } }
  `],
})
export class PlayerPaperDollComponent {
  readonly player = input.required<Player>();
  readonly kit = input.required<KitDesign>();
  readonly size = input(96);
  protected readonly skin = computed(() => SKIN[this.player().visuals.skinTone % SKIN.length]);
  protected readonly hair = computed(() => HAIR[this.player().visuals.hairColor % HAIR.length]);
  protected readonly numberColor = computed(() => contrastText(this.kit().shirt));
  protected readonly hairPath = computed(() => {
    const style = this.player().visuals.hairStyle % 6;
    if (style === 0) return 'M11 3h10v3H11z';
    if (style === 1) return 'M10 2h12v5H10z';
    if (style === 2) return 'M10 2h12v4H10zm0 4h3v5h-3z';
    if (style === 3) return 'M11 3h10v3H11zm2-2h3v2h-3zm5 0h3v3h-3z';
    if (style === 4) return 'M10 2h12v4H10zm9 3h3v6h-3z';
    return 'M10 2h12v5H10zm-1 2h3v6H9z';
  });
}
