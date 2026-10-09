import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GameStateService } from '../../core/services/game-state.service';
import { I18nService } from '../../core/services/i18n.service';
import { ControlPrefsService } from '../../core/services/control-prefs.service';
import {
  BINDABLE_ACTIONS, BUTTON_ACTIONS, BindableAction, ButtonAction, TouchLayout, bindButton, bindKey, buttonFor, buttonLabel, keyLabel, primaryKey,
} from '../../core/controls/control-prefs';
import { CONTROL_BINDINGS } from '../../data/control-bindings';

type Tab = 'keyboard' | 'gamepad' | 'touch';

const MOVE_LABELS: Record<string, { de: string; en: string }> = {
  'move-up': { de: 'Laufen: hoch', en: 'Move: up' },
  'move-left': { de: 'Laufen: links', en: 'Move: left' },
  'move-down': { de: 'Laufen: runter', en: 'Move: down' },
  'move-right': { de: 'Laufen: rechts', en: 'Move: right' },
};

/** Rebind keyboard and gamepad buttons and arrange the touch controls; stored per device, used by every mode. */
@Component({
  selector: 'app-controls',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './controls.page.html',
  styleUrl: './controls.page.scss',
})
export class ControlsPage {
  protected readonly gs = inject(GameStateService);
  protected readonly i18n = inject(I18nService);
  protected readonly controls = inject(ControlPrefsService);
  protected readonly tab = signal<Tab>('keyboard');
  protected readonly capturing = signal<BindableAction | null>(null);
  protected readonly message = signal('');
  protected readonly keyboardActions = BINDABLE_ACTIONS;
  protected readonly gamepadActions = BUTTON_ACTIONS;
  protected readonly touch = computed(() => this.controls.prefs().touch);
  protected readonly previewButtons = ['sw', 'sk', 'lt', 'y', 'x', 'b', 'a', 'rt'];
  private padFrame = 0;

  constructor() {
    window.addEventListener('keydown', this.onKey, true);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('keydown', this.onKey, true);
      cancelAnimationFrame(this.padFrame);
    });
  }

  protected text(de: string, en: string): string { return this.i18n.pick(de, en); }

  protected label(action: BindableAction): string {
    const move = MOVE_LABELS[action];
    if (move) return this.i18n.pick(move.de, move.en);
    const binding = CONTROL_BINDINGS.find((candidate) => candidate.action === action);
    return binding ? this.i18n.pick(binding.title.de, binding.title.en) : action;
  }

  protected key(action: BindableAction): string { return keyLabel(primaryKey(this.controls.prefs(), action)); }
  protected button(action: ButtonAction): string { return buttonLabel(buttonFor(this.controls.prefs(), action)); }
  protected custom(action: BindableAction): boolean { return !!this.controls.prefs().keyboard[action]; }

  protected startKeyCapture(action: BindableAction): void {
    this.cancelCapture();
    this.capturing.set(action);
    this.message.set(this.text(`Neue Taste für „${this.label(action)}“ drücken – Esc bricht ab.`, `Press a new key for “${this.label(action)}” – Esc cancels.`));
  }

  protected startPadCapture(action: ButtonAction): void {
    this.cancelCapture();
    this.capturing.set(action);
    this.message.set(this.text(`Gamepad-Taste für „${this.label(action)}“ drücken – Esc bricht ab.`, `Press a gamepad button for “${this.label(action)}” – Esc cancels.`));
    // Buttons held at the moment of the click must be released first.
    const held = new Set(this.pressedButtons());
    const poll = () => {
      if (this.capturing() !== action) return;
      const pressed = this.pressedButtons();
      for (const button of [...held]) if (!pressed.includes(button)) held.delete(button);
      const fresh = pressed.find((button) => !held.has(button));
      if (fresh === undefined) { this.padFrame = requestAnimationFrame(poll); return; }
      const result = bindButton(this.controls.prefs(), action, fresh);
      this.controls.update(result.prefs);
      this.capturing.set(null);
      this.message.set(result.swappedWith
        ? this.text(`${buttonLabel(fresh)} gesetzt. „${this.label(result.swappedWith)}“ hat die alte Taste übernommen.`, `${buttonLabel(fresh)} set. “${this.label(result.swappedWith)}” took the old button.`)
        : this.text(`${buttonLabel(fresh)} gesetzt.`, `${buttonLabel(fresh)} set.`));
    };
    this.padFrame = requestAnimationFrame(poll);
  }

  protected setTouch<K extends keyof TouchLayout>(key: K, value: TouchLayout[K]): void {
    this.controls.update({ ...this.controls.prefs(), touch: { ...this.touch(), [key]: value } });
  }

  protected touchNumber(key: 'scale' | 'opacity' | 'lift', event: Event): void {
    this.setTouch(key, Number((event.target as HTMLInputElement).value));
  }

  protected reset(part: Tab): void {
    this.cancelCapture();
    this.controls.reset(part);
    this.message.set(this.text('Standard wiederhergestellt.', 'Defaults restored.'));
  }

  private cancelCapture(): void {
    cancelAnimationFrame(this.padFrame);
    this.capturing.set(null);
  }

  private pressedButtons(): number[] {
    const pad = navigator.getGamepads?.().find((candidate) => !!candidate);
    return pad ? pad.buttons.flatMap((button, index) => (button.pressed ? [index] : [])) : [];
  }

  private readonly onKey = (event: KeyboardEvent) => {
    const action = this.capturing();
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code === 'Escape') {
      this.cancelCapture();
      this.message.set(this.text('Abgebrochen.', 'Cancelled.'));
      return;
    }
    if (this.tab() !== 'keyboard') return;
    const result = bindKey(this.controls.prefs(), action, event.code);
    if (!result.ok) {
      this.message.set(result.reason === 'arrow'
        ? this.text('Pfeiltasten bewegen immer – bitte eine andere Taste wählen.', 'Arrow keys always move – please pick another key.')
        : this.text(`${keyLabel(event.code)} ist reserviert (Pause, Taktik, Menüs).`, `${keyLabel(event.code)} is reserved (pause, tactics, menus).`));
      return;
    }
    this.controls.update(result.prefs);
    this.capturing.set(null);
    this.message.set(result.swappedWith
      ? this.text(`${keyLabel(event.code)} gesetzt. „${this.label(result.swappedWith)}“ liegt jetzt auf ${this.key(result.swappedWith)}.`, `${keyLabel(event.code)} set. “${this.label(result.swappedWith)}” moved to ${this.key(result.swappedWith)}.`)
      : this.text(`${keyLabel(event.code)} gesetzt.`, `${keyLabel(event.code)} set.`));
  };
}
