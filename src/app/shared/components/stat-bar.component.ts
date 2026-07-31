import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ratingColor } from '../rating-color';

@Component({
  selector: 'app-stat-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stat">
      <span class="label">{{ label() }}</span>
      <div class="track">
        <div class="fill" [style.width.%]="value()" [style.background]="color()"></div>
      </div>
      <span class="val tabular" [style.color]="color()">{{ value() }}</span>
    </div>
  `,
  styles: [
    `
      .stat {
        display: grid;
        grid-template-columns: 88px 1fr 28px;
        align-items: center;
        gap: 10px;
        font-size: 13px;
      }
      .label {
        color: var(--text-dim);
        text-transform: capitalize;
      }
      .track {
        height: 8px;
        border-radius: 6px;
        background: var(--bg-800);
        overflow: hidden;
      }
      .fill {
        height: 100%;
        border-radius: 6px;
        transition: width 300ms ease;
      }
      .val {
        text-align: right;
        font-weight: 700;
      }
    `,
  ],
})
export class StatBarComponent {
  readonly label = input.required<string>();
  readonly value = input.required<number>();

  color(): string {
    return ratingColor(this.value());
  }
}
