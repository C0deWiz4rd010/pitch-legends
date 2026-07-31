import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PlayerAttributes } from '../../models/player.model';
import { ATTRIBUTE_KEYS, AttributeKey } from '../../models/enums';

interface Axis {
  key: AttributeKey;
  short: string;
  x: number;
  y: number;
  lx: number;
  ly: number;
  value: number;
}

const SHORT: Record<AttributeKey, string> = {
  pace: 'PAC',
  shooting: 'SHO',
  passing: 'PAS',
  dribbling: 'DRI',
  defending: 'DEF',
  physical: 'PHY',
  stamina: 'STA',
  goalkeeping: 'GK',
};

@Component({
  selector: 'app-radar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + size() + ' ' + size()" class="radar">
      @for (ring of rings(); track ring) {
        <polygon [attr.points]="ring" class="grid" />
      }
      @for (a of axes(); track a.key) {
        <line [attr.x1]="center()" [attr.y1]="center()" [attr.x2]="a.x" [attr.y2]="a.y" class="spoke" />
        <text [attr.x]="a.lx" [attr.y]="a.ly" class="axis-label">{{ a.short }}</text>
      }
      <polygon [attr.points]="dataPoints()" class="data" />
      @for (a of axes(); track a.key) {
        <circle [attr.cx]="pointFor(a).x" [attr.cy]="pointFor(a).y" r="2.6" class="dot" />
      }
    </svg>
  `,
  styles: [
    `
      .radar {
        width: 100%;
        height: auto;
        display: block;
      }
      .grid {
        fill: none;
        stroke: var(--border-soft);
        stroke-width: 1;
      }
      .spoke {
        stroke: var(--border-soft);
        stroke-width: 1;
      }
      .axis-label {
        fill: var(--text-mute);
        font-size: 10px;
        font-weight: 700;
        text-anchor: middle;
        dominant-baseline: middle;
      }
      .data {
        fill: rgba(56, 224, 123, 0.22);
        stroke: var(--accent);
        stroke-width: 2;
      }
      .dot {
        fill: var(--accent);
      }
    `,
  ],
})
export class RadarChartComponent {
  readonly attributes = input.required<PlayerAttributes>();
  readonly size = input(240);

  center = computed(() => this.size() / 2);
  private radius = computed(() => this.size() / 2 - 26);

  axes = computed<Axis[]>(() => {
    const c = this.center();
    const r = this.radius();
    const attrs = this.attributes();
    return ATTRIBUTE_KEYS.map((key, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ATTRIBUTE_KEYS.length;
      return {
        key,
        short: SHORT[key],
        x: c + Math.cos(angle) * r,
        y: c + Math.sin(angle) * r,
        lx: c + Math.cos(angle) * (r + 14),
        ly: c + Math.sin(angle) * (r + 14),
        value: attrs[key],
      };
    });
  });

  rings = computed<string[]>(() => {
    const c = this.center();
    const r = this.radius();
    return [0.25, 0.5, 0.75, 1].map((scale) =>
      ATTRIBUTE_KEYS.map((_, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ATTRIBUTE_KEYS.length;
        return `${c + Math.cos(angle) * r * scale},${c + Math.sin(angle) * r * scale}`;
      }).join(' '),
    );
  });

  dataPoints = computed(() =>
    this.axes()
      .map((a) => {
        const p = this.pointFor(a);
        return `${p.x},${p.y}`;
      })
      .join(' '),
  );

  pointFor(a: Axis): { x: number; y: number } {
    const c = this.center();
    const r = this.radius();
    const i = this.axes().indexOf(a);
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ATTRIBUTE_KEYS.length;
    const scale = a.value / 99;
    return { x: c + Math.cos(angle) * r * scale, y: c + Math.sin(angle) * r * scale };
  }
}
