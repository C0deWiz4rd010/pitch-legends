import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { I18nService } from '../../core/services/i18n.service';
import type { ShootoutPrompt } from '../../core/services/arcade-match';
import type { Aim } from '../../core/football/shootout';
import { ShootoutBoardComponent } from './shootout-board.component';

export interface ShootoutOutcomeView {
  scored: boolean;
  saved: boolean;
  offTarget: boolean;
  player: string;
}

/**
 * The player's side of an interactive shoot-out: as the shooter pick a corner and power, as the
 * keeper guess a corner. The scoreboard above shows every kick so far.
 */
@Component({
  selector: 'app-shootout-panel',
  imports: [ShootoutBoardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="overlay"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="i18n.pick('Elfmeterschießen', 'Penalty shoot-out')"
    >
      <div class="panel">
        <app-shootout-board
          [shootout]="prompt().shootout"
          [homeName]="homeName()"
          [awayName]="awayName()"
          [instant]="true"
        />
        @if (last(); as result) {
          <p class="last" [class.good]="result.scored" aria-live="assertive">
            {{ result.player }}:
            {{
              result.scored
                ? i18n.pick('Tor!', 'Goal!')
                : result.offTarget
                  ? i18n.pick('Drüber!', 'Over the bar!')
                  : i18n.pick('Gehalten!', 'Saved!')
            }}
          </p>
        }
        @if (prompt().role === 'shoot') {
          <h3>{{ i18n.pick('Du schießt: ', 'You shoot: ') }}{{ prompt().takerName }}</h3>
          <small
            >{{ i18n.pick('Schuss', 'Shooting') }} {{ prompt().takerShooting }} ·
            {{ i18n.pick('gegen Torwart', 'against keeper') }} {{ prompt().keeperName }} ({{
              prompt().keeperGoalkeeping
            }})</small
          >
          <div
            class="aims"
            role="group"
            [attr.aria-label]="i18n.pick('Ecke wählen', 'Choose a corner')"
          >
            @for (option of aims; track option.aim) {
              <button
                type="button"
                [class.on]="aim() === option.aim"
                [attr.aria-pressed]="aim() === option.aim"
                (click)="aim.set(option.aim)"
              >
                {{ i18n.pick(option.de, option.en) }}
              </button>
            }
          </div>
          <label class="power"
            ><input type="checkbox" [checked]="power()" (change)="power.set(!power())" />
            {{
              i18n.pick(
                'Kraftschuss (schwerer zu halten, kann daneben gehen)',
                'Power shot (harder to save, can miss)'
              )
            }}</label
          >
          <button type="button" class="go" (click)="shoot.emit({ aim: aim(), power: power() })">
            {{ i18n.pick('SCHIESSEN', 'SHOOT') }}
          </button>
        } @else {
          <h3>{{ i18n.pick('Du hältst: ', 'You defend: ') }}{{ prompt().keeperName }}</h3>
          <small
            >{{ i18n.pick('Schütze', 'Taker') }} {{ prompt().takerName }} ({{
              prompt().takerShooting
            }})</small
          >
          <div
            class="aims"
            role="group"
            [attr.aria-label]="i18n.pick('Ecke raten', 'Guess a corner')"
          >
            @for (option of aims; track option.aim) {
              <button type="button" class="dive" (click)="dive.emit(option.aim)">
                {{ i18n.pick(option.de, option.en) }}
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .overlay {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: grid;
      place-items: center;
      padding: 16px;
      background: #02060cd9;
    }
    .panel {
      width: min(560px, 100%);
      padding: 14px;
      border: 2px solid var(--accent-3);
      background: var(--surface);
      box-shadow: 4px 4px 0 var(--ink-shadow);
    }
    h3 {
      margin: 12px 0 2px;
      font-size: 16px;
    }
    small {
      color: var(--muted);
      font-size: 11px;
    }
    .last {
      margin: 8px 0 0;
      padding: 6px 8px;
      color: #ffb3b5;
      border: 1px solid #e5484d;
      font: 700 12px/1.2 var(--font-pixel);
    }
    .last.good {
      color: var(--success);
      border-color: var(--success);
    }
    .aims {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin: 10px 0;
    }
    .aims button {
      padding: 14px 6px;
      color: var(--text);
      border: 2px solid var(--border);
      background: var(--bg-900);
      font: 700 12px/1 var(--font-pixel);
      cursor: pointer;
    }
    .aims button.on {
      color: var(--on-accent);
      border-color: var(--accent);
      background: var(--accent);
    }
    .aims button:focus-visible,
    .go:focus-visible {
      outline: 3px solid var(--accent-2);
      outline-offset: 2px;
    }
    .power {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 10px;
      font-size: 12px;
    }
    .go {
      width: 100%;
      padding: 12px;
      color: var(--on-accent);
      border: 0;
      background: var(--accent);
      font: 700 13px/1 var(--font-pixel);
      cursor: pointer;
    }
  `,
})
export class ShootoutPanelComponent {
  protected readonly i18n = inject(I18nService);
  readonly prompt = input.required<ShootoutPrompt>();
  readonly homeName = input('');
  readonly awayName = input('');
  readonly last = input<ShootoutOutcomeView | null>(null);
  readonly shoot = output<{ aim: Aim; power: boolean }>();
  readonly dive = output<Aim>();

  protected readonly aim = signal<Aim>(1);
  protected readonly power = signal(false);
  protected readonly aims: { aim: Aim; de: string; en: string }[] = [
    { aim: -1, de: '◀ LINKS', en: '◀ LEFT' },
    { aim: 0, de: 'MITTE', en: 'CENTRE' },
    { aim: 1, de: 'RECHTS ▶', en: 'RIGHT ▶' },
  ];
}
