import { Page } from '@playwright/test';

/**
 * The game keeps its saves in IndexedDB (database `pitch-legends`, one object store per area).
 * These helpers read it from the page the way the app does; values written to localStorage
 * are imported by the app on the next load, which is how tests seed or edit a save.
 */

const AREA_OF = `(key) => key.startsWith('pitch-legends:save:') ? 'career'
  : key.startsWith('pitch-legends:legends:') ? 'legends'
  : key.startsWith('pitch-legends:match-checkpoint:') ? 'checkpoints'
  : key.startsWith('pitch-legends:backup:') ? 'backups' : 'prefs'`;

/** Wipes every save: localStorage and the IndexedDB database. */
export async function resetStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('pitch-legends');
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  });
}

/** The parsed value stored under `key`, or null. */
export async function readStore<T = any>(page: Page, key: string): Promise<T | null> {
  const raw = await page.evaluate(async ([key, areaOf]) => {
    const legacy = localStorage.getItem(key);
    if (legacy !== null) return legacy;
    const area = (0, eval)(areaOf)(key) as string;
    return new Promise<string | null>((resolve) => {
      const open = indexedDB.open('pitch-legends');
      open.onerror = () => resolve(null);
      open.onupgradeneeded = () => open.transaction?.abort();
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(area)) { db.close(); resolve(null); return; }
        const get = db.transaction(area, 'readonly').objectStore(area).get(key);
        get.onsuccess = () => { db.close(); resolve((get.result as string | undefined) ?? null); };
        get.onerror = () => { db.close(); resolve(null); };
      };
    });
  }, [key, AREA_OF] as const);
  return raw === null ? null : (JSON.parse(raw) as T);
}

/** Every stored key of the game, in IndexedDB and localStorage. */
export async function storeKeys(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith('pitch-legends:'));
    const stored = await new Promise<string[]>((resolve) => {
      const open = indexedDB.open('pitch-legends');
      open.onerror = () => resolve([]);
      open.onupgradeneeded = () => open.transaction?.abort();
      open.onsuccess = () => {
        const db = open.result;
        const areas = [...db.objectStoreNames];
        if (!areas.length) { db.close(); resolve([]); return; }
        const transaction = db.transaction(areas, 'readonly');
        const all: string[] = [];
        for (const area of areas) {
          const request = transaction.objectStore(area).getAllKeys();
          request.onsuccess = () => all.push(...request.result.map(String));
        }
        transaction.oncomplete = () => { db.close(); resolve(all); };
        transaction.onerror = () => { db.close(); resolve(all); };
      };
    });
    return [...new Set([...keys, ...stored])].sort();
  });
}

/** Queues a value that the app imports (and prefers) when the page loads next. */
export async function seedStore(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(([key, json]) => localStorage.setItem(key, json), [key, JSON.stringify(value)] as const);
}
