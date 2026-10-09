import { Injectable, inject, signal } from '@angular/core';
import { PersistentStore } from '../storage/persistent-store';
import { ControlPrefs, defaultControlPrefs, normaliseControlPrefs } from '../controls/control-prefs';

export const CONTROL_PREFS_KEY = 'pitch-legends:controls:v1';

/** Key bindings and touch layout belong to the device, not to a career, so every mode uses them. */
@Injectable({ providedIn: 'root' })
export class ControlPrefsService {
  private readonly store = inject(PersistentStore);
  readonly prefs = signal<ControlPrefs>(this.load());

  update(prefs: ControlPrefs): void {
    const next = normaliseControlPrefs(prefs);
    this.prefs.set(next);
    void this.store.set(CONTROL_PREFS_KEY, JSON.stringify(next));
  }

  reset(part: 'keyboard' | 'gamepad' | 'touch'): void {
    this.update({ ...this.prefs(), [part]: defaultControlPrefs()[part] });
  }

  private load(): ControlPrefs {
    try {
      return normaliseControlPrefs(JSON.parse(this.store.get(CONTROL_PREFS_KEY) ?? 'null'));
    } catch {
      return defaultControlPrefs();
    }
  }
}
