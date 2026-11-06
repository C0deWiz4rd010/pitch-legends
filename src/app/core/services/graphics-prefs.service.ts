import { Injectable, inject, signal } from '@angular/core';
import { DEFAULT_GRAPHICS_PREFS, GRAPHICS_PREFS_KEY, GraphicsPrefs, sanitizeGraphicsPrefs } from '../graphics-prefs';
import { PersistentStore } from '../storage/persistent-store';

/** Graphics quality, frame cap and render scale of this device; read when a match's 3D view is created. */
@Injectable({ providedIn: 'root' })
export class GraphicsPrefsService {
  private readonly store = inject(PersistentStore);
  readonly prefs = signal<GraphicsPrefs>(this.load());

  update(patch: Partial<GraphicsPrefs>): void {
    const next = sanitizeGraphicsPrefs({ ...this.prefs(), ...patch });
    this.prefs.set(next);
    void this.store.set(GRAPHICS_PREFS_KEY, JSON.stringify(next));
  }

  private load(): GraphicsPrefs {
    try {
      return sanitizeGraphicsPrefs(JSON.parse(this.store.get(GRAPHICS_PREFS_KEY) ?? 'null'));
    } catch {
      return { ...DEFAULT_GRAPHICS_PREFS };
    }
  }
}
