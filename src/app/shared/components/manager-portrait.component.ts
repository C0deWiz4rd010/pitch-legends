import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ManagerProfile } from '../../models/game.model';

const SKIN = ['#f5d0a9', '#e9b989', '#d99a68', '#bf7b50', '#9b5c3d', '#75422f', '#573126', '#35221f'];
const HAIR = ['#17141d', '#2c1b18', '#4b2e24', '#71462b', '#9b673d', '#c89b62', '#d9c6a2', '#702c32'];

@Component({
  selector: 'app-manager-portrait',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()' },
  template: `
    <svg viewBox="0 0 48 56" role="img" [attr.aria-label]="manager().firstName + ' ' + manager().lastName" shape-rendering="crispEdges">
      <rect width="48" height="56" fill="#080c18" />
      <path d="M5 56V43l8-9h22l8 9v13z" [attr.fill]="manager().visuals.outfitColor" stroke="#050713" stroke-width="3" />
      @if (manager().visuals.outfit === 'suit') {
        <path d="m14 35 10 12 10-12-4-2H18z" fill="#edf2ff" /><path d="m22 41 2 10 3-10-3-4z" [attr.fill]="manager().visuals.accentColor" />
      } @else if (manager().visuals.outfit === 'tracksuit') {
        <path d="M23 34h3v22h-3zM9 42h30v3H9z" [attr.fill]="manager().visuals.accentColor" />
      } @else {
        <path d="M10 39h28v5H10z" [attr.fill]="manager().visuals.accentColor" /><path d="M18 34h12l-2 8h-8z" fill="#151a2c" />
      }
      <path [attr.d]="headPath()" [attr.fill]="skin()" stroke="#050713" stroke-width="3" />
      <path [attr.d]="hairPath()" [attr.fill]="hair()" />
      <path d="M17 22h3v2h-3zm11 0h3v2h-3z" fill="#0b0d17" />
      @if (manager().visuals.facialHair > 0) { <path d="M17 27h14v6H17z" [attr.fill]="hair()" opacity=".9" /> }
      @if (manager().visuals.glasses !== 'none') {
        <path d="M14 19h9v7h-9zm11 0h9v7h-9zM23 21h2" fill="none" [attr.stroke]="manager().visuals.accentColor" stroke-width="2" />
      }
      @if (manager().age >= 52) { <path d="M13 17h4v1h-4zm18 0h4v1h-4z" fill="#f4f4df" opacity=".55" /> }
    </svg>
  `,
  styles: [`
    :host { display:inline-grid; overflow:hidden; border:2px solid var(--border); background:#080c18; box-shadow:3px 3px 0 #02030a; image-rendering:pixelated; }
    svg { width:100%; height:100%; image-rendering:pixelated; }
  `],
})
export class ManagerPortraitComponent {
  readonly manager = input.required<ManagerProfile>();
  readonly size = input(64);
  protected readonly skin = computed(() => SKIN[this.manager().visuals.skinTone % SKIN.length]);
  protected readonly hair = computed(() => HAIR[this.manager().visuals.hairColor % HAIR.length]);
  protected readonly headPath = computed(() => {
    const shape = this.manager().visuals.headShape % 4;
    return shape === 0 ? 'M13 8h22v22l-5 6H18l-5-6z' : shape === 1 ? 'M11 10h26v18l-7 8H18l-7-8z' : shape === 2 ? 'M14 7h20l3 8-3 18-10 4-10-4-3-18z' : 'M12 9h24v23l-6 5H18l-6-5z';
  });
  protected readonly hairPath = computed(() => {
    const style = this.manager().visuals.hairStyle % 6;
    if (style === 0) return 'M13 8h22v5H13z';
    if (style === 1) return 'M11 7h26v8H11z';
    if (style === 2) return 'M12 7h24v7H12zm0 5h5v11h-5z';
    if (style === 3) return 'M13 8h22v5H13zm3-4h5v5h-5zm9 1h6v5h-6z';
    if (style === 4) return 'M11 6h26v8H11zm21 6h5v12h-5z';
    return 'M12 7h24v7H12zm-2 5h6v13h-6z';
  });
}
