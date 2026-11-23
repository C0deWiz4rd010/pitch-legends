import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ShotRecord } from '../../models/match.model';
import { xgAxisEnd, xgPath, xgSteps } from './shot-charts';

/** How the chances added up over the match: one stepped line of cumulative xG per side, goals marked on it. */
@Component({
  selector: 'app-xg-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 320 118" class="xg" role="img" [attr.aria-label]="label()">
      <g class="grid">
        @for (line of grid(); track line.y) { <line x1="28" x2="312" [attr.y1]="line.y" [attr.y2]="line.y" /><text x="23" [attr.y]="line.y + 3" text-anchor="end">{{ line.value }}</text> }
        @for (tick of ticks(); track tick.minute) { <text [attr.x]="tick.x" y="114" text-anchor="middle">{{ tick.minute }}'</text> }
      </g>
      <g transform="translate(28 8)">
        <path [attr.d]="chart().away" class="line" [attr.stroke]="awayColor()" />
        <path [attr.d]="chart().home" class="line" [attr.stroke]="homeColor()" />
        @for (goal of chart().goals; track $index) { <circle [attr.cx]="goal.x" [attr.cy]="goal.y" r="3.2" [attr.fill]="goal.color" class="goal" /> }
      </g>
    </svg>
  `,
  styles: [`
    .xg { width: 100%; height: auto; display: block; }
    .grid line { stroke: rgba(236, 244, 222, 0.16); stroke-width: 0.6; }
    .grid text { fill: rgba(236, 244, 222, 0.62); font: 10px var(--font-body, monospace); }
    .line { fill: none; stroke-width: 2.2; stroke-linejoin: round; paint-order: stroke; filter: drop-shadow(0 0 1px rgba(2, 8, 14, 0.9)); }
    .goal { stroke: #f4f4df; stroke-width: 1.2; }
  `],
})
export class XgTimelineComponent {
  readonly shots = input<readonly ShotRecord[]>([]);
  /** Minute the match has reached (45 at half time, 90 or more at the end). */
  readonly minute = input(90);
  readonly homeColor = input('#54f28b');
  readonly awayColor = input('#ff7c8f');
  readonly label = input('xG');

  private readonly scale = computed(() => {
    const shots = this.shots();
    const home = xgSteps(shots, 'home'), away = xgSteps(shots, 'away');
    const most = Math.max(home.at(-1)?.total ?? 0, away.at(-1)?.total ?? 0);
    // The top of the chart is the next half goal above the higher total.
    return { home, away, end: xgAxisEnd(shots, this.minute()), peak: Math.max(0.5, Math.ceil(most * 2 + 0.01) / 2) };
  });

  protected readonly chart = computed(() => {
    const { home, away, end, peak } = this.scale();
    const mark = (steps: typeof home, color: string) => steps.filter((step) => step.goal)
      .map((step) => ({ x: Math.min(1, step.minute / end) * 284, y: 90 - Math.min(1, step.total / peak) * 90, color }));
    return { home: xgPath(home, end, peak, 284, 90), away: xgPath(away, end, peak, 284, 90), goals: [...mark(away, this.awayColor()), ...mark(home, this.homeColor())] };
  });

  protected readonly grid = computed(() => {
    const peak = this.scale().peak;
    return [0, 0.5, 1].map((share) => ({ y: 98 - share * 90, value: (peak * share).toFixed(peak * share % 1 ? (peak < 1 ? 2 : 1) : 0) }));
  });

  protected readonly ticks = computed(() => {
    const end = this.scale().end;
    const step = end > 60 ? 15 : end > 30 ? 10 : 5;
    const ticks: { minute: number; x: number }[] = [];
    for (let minute = step; minute <= end; minute += step) ticks.push({ minute, x: 28 + minute / end * 284 });
    return ticks;
  });
}
