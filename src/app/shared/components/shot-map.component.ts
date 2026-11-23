import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ShotRecord } from '../../models/match.model';
import { shotMarker } from './shot-charts';

/** Where the shots came from: the home side attacks to the right, the away side to the left; bigger dots were better chances. */
@Component({
  selector: 'app-shot-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 105 68" class="shot-map" role="img" [attr.aria-label]="label()">
      <rect x="0" y="0" width="105" height="68" class="turf" />
      <g class="lines">
        <rect x="0.4" y="0.4" width="104.2" height="67.2" />
        <line x1="52.5" y1="0" x2="52.5" y2="68" />
        <circle cx="52.5" cy="34" r="9.15" />
        <rect x="0.4" y="13.84" width="16.5" height="40.32" />
        <rect x="88.1" y="13.84" width="16.5" height="40.32" />
        <rect x="0.4" y="24.84" width="5.5" height="18.32" />
        <rect x="99.1" y="24.84" width="5.5" height="18.32" />
      </g>
      @for (shot of markers(); track $index) {
        <circle [attr.cx]="shot.x" [attr.cy]="shot.y" [attr.r]="shot.r" [attr.fill]="shot.goal ? shot.color : 'rgba(6, 18, 24, 0.55)'" [attr.stroke]="shot.goal ? '#f4f4df' : shot.color" class="shot" />
      }
    </svg>
  `,
  styles: [`
    .shot-map { width: 100%; height: auto; display: block; }
    .turf { fill: #1c5f3a; }
    .lines rect, .lines line, .lines circle { fill: none; stroke: rgba(236, 244, 222, 0.5); stroke-width: 0.35; }
    .shot { stroke-width: 0.6; }
  `],
})
export class ShotMapComponent {
  readonly shots = input<readonly ShotRecord[]>([]);
  readonly homeColor = input('#54f28b');
  readonly awayColor = input('#ff7c8f');
  readonly label = input('Shot map');

  /** Goals are drawn last, so they lie on top of the misses around them. */
  protected readonly markers = computed(() => [...this.shots()].sort((a, b) => Number(a.goal) - Number(b.goal))
    .map((shot) => ({ ...shotMarker(shot), goal: shot.goal, color: shot.side === 'home' ? this.homeColor() : this.awayColor() })));
}
