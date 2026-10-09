import { Injectable, InjectionToken, inject, signal } from '@angular/core';

/**
 * Every persisted value of the game goes through this store.
 *
 * The browser keeps the data in IndexedDB, split into separate object stores for the career, Legends Team,
 * match checkpoints, backups and small preferences. Reads stay synchronous: the whole store is read into memory
 * once before the app starts (see `provideAppInitializer` in `app.config.ts`), writes update that memory copy at
 * once and reach the disk asynchronously, so a save never blocks a frame. Values written by older versions into
 * localStorage are moved over on start. Without IndexedDB (old browsers, unit tests) the store falls back to
 * localStorage directly.
 */

export const STORE_PREFIX = 'pitch-legends:';
export const IDB_NAME = 'pitch-legends';
export const IDB_VERSION = 1;
export const STORAGE_AREAS = ['career', 'legends', 'checkpoints', 'backups', 'prefs'] as const;
export type StorageArea = (typeof STORAGE_AREAS)[number];

export type SaveFailure = 'quota' | 'unavailable' | 'unknown';
export type SaveResult = { ok: true } | { ok: false; reason: SaveFailure; message: string };
export interface StorageIssue { reason: SaveFailure; key: string; message: string; at: number }
export interface StoreOperation { key: string; value: string | null }
export type StorageBackend = 'indexeddb' | 'localstorage' | 'memory';

/** The IndexedDB implementation the store opens; `null` forces the localStorage fallback. */
export const INDEXED_DB = new InjectionToken<IDBFactory | null>('pitch-legends IndexedDB factory', {
  providedIn: 'root',
  factory: () => (typeof indexedDB !== 'undefined' ? indexedDB : null),
});

/** Opening IndexedDB can hang (blocked upgrade, private modes); the game then starts on localStorage. */
const OPEN_TIMEOUT_MS = 4000;

export function areaFor(key: string): StorageArea {
  if (key.startsWith(`${STORE_PREFIX}save:`)) return 'career';
  if (key.startsWith(`${STORE_PREFIX}legends:`)) return 'legends';
  if (key.startsWith(`${STORE_PREFIX}match-checkpoint:`)) return 'checkpoints';
  if (key.startsWith(`${STORE_PREFIX}backup:`)) return 'backups';
  return 'prefs';
}

export function failureOf(error: unknown): SaveFailure {
  const name = (error as { name?: string } | null)?.name ?? '';
  const code = (error as { code?: number } | null)?.code;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) return 'quota';
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'UnknownError') return 'unavailable';
  return 'unknown';
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // Access itself throws when site data is blocked.
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Transaction aborted', 'AbortError'));
    transaction.onerror = () => reject(transaction.error);
  });
}

@Injectable({ providedIn: 'root' })
export class PersistentStore {
  private readonly factory = inject(INDEXED_DB);
  private readonly cache = new Map<string, string>();
  private db: IDBDatabase | null = null;
  private opening: Promise<void> | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  readonly backend = signal<StorageBackend>('localstorage');
  /** The latest failed write; the shell shows it until the player dismisses it or a later write succeeds. */
  readonly issue = signal<StorageIssue | null>(null);

  /** Opens IndexedDB, moves old localStorage values over and reads everything into memory. */
  ready(): Promise<void> {
    this.opening ??= this.open();
    return this.opening;
  }

  get(key: string): string | null {
    if (this.db) return this.cache.get(key) ?? null;
    if (this.backend() === 'memory') return this.cache.get(key) ?? null;
    try {
      return localStorageOrNull()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  keys(prefix = STORE_PREFIX): string[] {
    if (this.db || this.backend() === 'memory') return [...this.cache.keys()].filter((key) => key.startsWith(prefix));
    const storage = localStorageOrNull();
    if (!storage) return [];
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    return keys;
  }

  set(key: string, value: string): Promise<SaveResult> {
    return this.batch([{ key, value }]);
  }

  remove(...keys: string[]): Promise<SaveResult> {
    return this.batch(keys.map((key) => ({ key, value: null })));
  }

  /**
   * Writes several values in one transaction: either all of them reach the disk or none does.
   * Reads see the new values immediately.
   */
  batch(operations: StoreOperation[]): Promise<SaveResult> {
    if (!operations.length) return Promise.resolve({ ok: true });
    if (!this.db) return Promise.resolve(this.report(operations, this.writeLocal(operations)));
    for (const { key, value } of operations) {
      if (value === null) this.cache.delete(key);
      else this.cache.set(key, value);
    }
    const db = this.db;
    const write = this.writes.then(async (): Promise<SaveResult> => {
      let transaction: IDBTransaction | null = null;
      let finished: Promise<void> | null = null;
      try {
        const areas = [...new Set(operations.map(({ key }) => areaFor(key)))];
        transaction = db.transaction(areas, 'readwrite');
        finished = done(transaction);
        for (const { key, value } of operations) {
          const store = transaction.objectStore(areaFor(key));
          if (value === null) store.delete(key);
          else store.put(value, key);
        }
        await finished;
        return { ok: true };
      } catch (error) {
        // A request that throws must not let the rest of the batch commit on its own.
        try { transaction?.abort(); } catch { /* already finished */ }
        await finished?.catch(() => undefined);
        return { ok: false, reason: failureOf(error), message: String((error as Error)?.message ?? error) };
      }
    }).then((result) => this.report(operations, result));
    this.writes = write;
    return write;
  }

  /** Resolves once every write issued so far has reached the disk (or failed). */
  async flush(): Promise<void> {
    await this.writes;
  }

  dismissIssue(): void {
    this.issue.set(null);
  }

  /** Removes everything this game stored, in both backends. */
  async clearAll(): Promise<void> {
    await this.remove(...this.keys());
    const storage = localStorageOrNull();
    if (storage) for (const key of this.keysOf(storage)) storage.removeItem(key);
  }

  private report(operations: StoreOperation[], result: SaveResult): SaveResult {
    if (result.ok) {
      if (this.issue()) this.issue.set(null);
    } else {
      this.issue.set({ reason: result.reason, key: operations[0].key, message: result.message, at: Date.now() });
    }
    return result;
  }

  private writeLocal(operations: StoreOperation[]): SaveResult {
    const storage = localStorageOrNull();
    if (!storage) {
      // No persistent storage at all: keep the session playable in memory.
      this.backend.set('memory');
      for (const { key, value } of operations) {
        if (value === null) this.cache.delete(key);
        else this.cache.set(key, value);
      }
      return { ok: false, reason: 'unavailable', message: 'No persistent storage available.' };
    }
    const previous = operations.map(({ key }) => [key, storage.getItem(key)] as const);
    try {
      for (const { key, value } of operations) {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      }
      return { ok: true };
    } catch (error) {
      // Roll back so a half-written batch never pairs a new career with an old checkpoint.
      for (const [key, value] of previous) {
        try {
          if (value === null) storage.removeItem(key);
          else storage.setItem(key, value);
        } catch { /* best effort */ }
      }
      return { ok: false, reason: failureOf(error), message: String((error as Error)?.message ?? error) };
    }
  }

  private keysOf(storage: Storage): string[] {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(STORE_PREFIX)) keys.push(key);
    }
    return keys;
  }

  private async open(): Promise<void> {
    if (!this.factory) return;
    let db: IDBDatabase;
    try {
      db = await Promise.race([
        this.openDatabase(this.factory),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('IndexedDB open timed out')), OPEN_TIMEOUT_MS)),
      ]);
    } catch {
      return; // localStorage stays the backend.
    }
    try {
      const transaction = db.transaction([...STORAGE_AREAS], 'readonly');
      const loaded = await Promise.all(STORAGE_AREAS.map(async (area) => {
        const store = transaction.objectStore(area);
        const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
        return keys.map((key, index) => [String(key), values[index] as string] as const);
      }));
      for (const [key, value] of loaded.flat()) if (typeof value === 'string') this.cache.set(key, value);
    } catch {
      db.close();
      return;
    }
    this.db = db;
    this.backend.set('indexeddb');
    db.onversionchange = () => db.close();
    await this.importLocalStorage();
  }

  private openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const open = factory.open(IDB_NAME, IDB_VERSION);
      open.onupgradeneeded = () => {
        for (const area of STORAGE_AREAS) if (!open.result.objectStoreNames.contains(area)) open.result.createObjectStore(area);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
    });
  }

  /**
   * Values in localStorage come from versions before IndexedDB (or from a session that had to fall back).
   * They are newer than anything IndexedDB holds for the same key, so they win, and leave localStorage
   * only after IndexedDB has committed them.
   */
  private async importLocalStorage(): Promise<void> {
    const storage = localStorageOrNull();
    if (!storage) return;
    const keys = this.keysOf(storage);
    if (!keys.length) return;
    const operations = keys.map((key) => ({ key, value: storage.getItem(key) }))
      .filter((operation): operation is { key: string; value: string } => operation.value !== null);
    const result = await this.batch(operations);
    if (result.ok) for (const key of keys) storage.removeItem(key);
  }
}
