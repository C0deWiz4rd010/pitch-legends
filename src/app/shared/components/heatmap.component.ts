import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Where a player spent the match: weighted cells on a 105 × 68 pitch. */
@Component({
  selector: 'app-heatmap',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 105 68" class="heatmap" role="img" [attr.aria-label]="label()">
      <rect x="0" y="0" width="105" height="68" class="turf" />
      <g class="lines">
        <rect x="0.4" y="0.4" width="104.2" height="67.2" />
        <line x1="52.5" y1="0" x2="52.5" y2="68" />
        <circle cx="52.5" cy="34" r="9.15" />
        <rect x="0.4" y="13.84" width="16.5" height="40.32" />
        <rect x="88.1" y="13.84" width="16.5" height="40.32" />
      </g>
      @for (cell of cells(); track $index) {
        <circle [attr.cx]="cell.x" [attr.cy]="cell.y" [attr.r]="cell.r" [attr.opacity]="cell.opacity" class="heat" />
      }
    </svg>
  `,
  styles: [`
    .heatmap { width: 100%; height: auto; display: block; }
    .turf { fill: #1f6b3f; }
    .lines rect, .lines line, .lines circle { fill: none; stroke: rgba(236, 244, 222, 0.55); stroke-width: 0.35; }
    .heat { fill: #ffd34e; }
  `],
})
export class HeatmapComponent {
  readonly points = input<{ x: number; y: number; weight: number }[]>([]);
  readonly label = input('Heatmap');
  /** Mirror so that the side always attacks to the right. */
  readonly mirror = input(false);

  protected readonly cells = computed(() => {
    const points = this.points();
    const max = Math.max(1, ...points.map(point => point.weight));
    return points.map(point => ({
      x: this.mirror() ? 105 - point.x : point.x,
      y: point.y,
      r: 3 + 5 * Math.sqrt(point.weight / max),
      opacity: 0.18 + 0.55 * point.weight / max,
    }));
  });
}
