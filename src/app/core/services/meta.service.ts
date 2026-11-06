import { Injectable, computed, inject, signal } from '@angular/core';
import { CosmeticSlot, MetaState, emptyMeta, emptyRecords } from '../../models/meta.model';
import { PersistentStore } from '../storage/persistent-store';
import { MetaEvent, applyMetaEvent } from '../meta/meta-events';
import { equipCosmetic, pathProgress, rewardsOfLevel, wornCosmetics } from '../meta/legend-path';
import { ACHIEVEMENTS } from '../meta/achievements';

export const META_STORAGE_KEY = 'pitch-legends:meta:v1';

export interface MetaToast {
  id: number;
  kind: 'achievement' | 'level';
  title: [string, string];
  text: [string, string];
}

/** Reads a stored meta state, repairing what is missing; anything that is not one gives a fresh state. Exported for tests. */
export function parseMeta(raw: string | null | undefined): MetaState {
  if (!raw) return emptyMeta();
  try {
    const parsed = JSON.parse(raw) as Partial<MetaState>;
    if (!parsed || parsed.version !== 1 || typeof parsed.xp !== 'number') return emptyMeta();
    const meta = emptyMeta();
    meta.xp = Math.max(0, Math.floor(parsed.xp));
    meta.counters = Object.fromEntries(Object.entries(parsed.counters ?? {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)));
    meta.unlocked = Object.fromEntries(Object.entries(parsed.unlocked ?? {}).filter(([id, order]) => ACHIEVEMENTS.some((def) => def.id === id) && typeof order === 'number'));
    meta.equipped = (parsed.equipped ?? {}) as MetaState['equipped'];
    meta.records = { ...emptyRecords(), ...(parsed.records ?? {}) };
    return meta;
  } catch {
    return emptyMeta();
  }
}

/** The meta layer of the game: achievements, the Legends Path and the Hall of Fame records, in a save of their own. */
@Injectable({ providedIn: 'root' })
export class MetaService {
  private readonly store = inject(PersistentStore);
  private readonly stateSignal = signal<MetaState>(parseMeta(this.store.get(META_STORAGE_KEY)));
  readonly state = this.stateSignal.asReadonly();
  readonly progress = computed(() => pathProgress(this.stateSignal().xp));
  readonly worn = computed(() => wornCosmetics(this.stateSignal()));
  readonly toasts = signal<MetaToast[]>([]);
  private toastSerial = 0;

  /** Tells the meta layer what happened. Returns nothing the caller has to act on; unlocks show up as toasts. */
  record(event: MetaEvent): void {
    const meta = structuredClone(this.stateSignal());
    const outcome = applyMetaEvent(meta, event);
    this.stateSignal.set(meta);
    void this.store.set(META_STORAGE_KEY, JSON.stringify(meta));
    const toasts: MetaToast[] = [
      ...outcome.unlocked.map((def) => ({ id: ++this.toastSerial, kind: 'achievement' as const, title: def.name, text: def.text })),
      ...outcome.levels.map((level) => ({
        id: ++this.toastSerial,
        kind: 'level' as const,
        title: [`Legenden-Weg: Level ${level}`, `Legends Path: level ${level}`] as [string, string],
        text: (rewardsOfLevel(level).map((reward) => reward.name) as [string, string][]).reduce<[string, string]>(
          (line, name) => [`${line[0]}${line[0] ? ', ' : ''}${name[0]}`, `${line[1]}${line[1] ? ', ' : ''}${name[1]}`],
          ['', ''],
        ),
      })),
    ];
    if (toasts.length) this.toasts.update((list) => [...list, ...toasts].slice(-6));
  }

  /** Wears a cosmetic, or takes it off with `null`. False when it is still locked. */
  equip(slot: CosmeticSlot, id: string | null): boolean {
    const meta = structuredClone(this.stateSignal());
    if (!equipCosmetic(meta, slot, id)) return false;
    this.stateSignal.set(meta);
    void this.store.set(META_STORAGE_KEY, JSON.stringify(meta));
    return true;
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((toast) => toast.id !== id));
  }

  /** Start over: only for the settings page. */
  reset(): void {
    const meta = emptyMeta();
    this.stateSignal.set(meta);
    void this.store.set(META_STORAGE_KEY, JSON.stringify(meta));
  }
}
