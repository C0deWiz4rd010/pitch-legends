import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { INDEXED_DB, IDB_NAME, PersistentStore, StorageArea } from './core/storage/persistent-store';
import { CAREER_KEY, CORRUPT_BACKUP_KEY, LAST_GOOD_BACKUP_KEY, SaveService, exportFileName, migrationBackupKey } from './core/services/save.service';
import { GameStateService } from './core/services/game-state.service';
import { MATCH_CHECKPOINT_KEY, MatchCheckpointService } from './core/services/match-checkpoint.service';
import { CONTROL_PREFS_KEY, ControlPrefsService } from './core/services/control-prefs.service';
import { bindButton, bindKey, defaultControlPrefs, keysFor, normaliseControlPrefs, primaryKey } from './core/controls/control-prefs';
import { createNewGame } from './data/generators';
import { GameState } from './models/game.model';

async function openStore(factory: IDBFactory | null): Promise<PersistentStore> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: INDEXED_DB, useValue: factory }] });
  const store = TestBed.inject(PersistentStore);
  await store.ready();
  return store;
}

/** Reads one value straight from IndexedDB, bypassing the store's memory copy. */
function onDisk(factory: IDBFactory, area: StorageArea, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = factory.open(IDB_NAME);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction(area, 'readonly').objectStore(area).get(key);
      get.onsuccess = () => { open.result.close(); resolve(get.result); };
      get.onerror = () => reject(get.error);
    };
  });
}

function olderSave(version: 5): GameState {
  const game = createNewGame({ managerName: 'Old Timer', clubName: 'Legacy FC', seed: 4242 }) as Partial<GameState>;
  // A version 5 save knew nothing of the second division, cup, archive, board, scouting or academy.
  const legacy = structuredClone(game) as any;
  const firstDivision = new Set(legacy.league.teamIds);
  legacy.teams = legacy.teams.filter((team: { id: string }) => firstDivision.has(team.id));
  legacy.managers = legacy.managers.filter((manager: { clubId: string }) => firstDivision.has(manager.clubId));
  for (const key of ['otherLeagues', 'cup', 'archive', 'board', 'scouting', 'academy']) delete legacy[key];
  for (const team of legacy.teams) delete team.finance;
  legacy.version = version;
  return legacy as GameState;
}

describe('Platform: IndexedDB saves, failures and recovery', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); TestBed.resetTestingModule(); });

  it('moves old localStorage values into separate IndexedDB areas and reads them synchronously', async () => {
    const factory = new IDBFactory();
    localStorage.setItem('pitch-legends:save:v6', '{"career":1}');
    localStorage.setItem('pitch-legends:legends:v1', '{"legends":1}');
    localStorage.setItem('pitch-legends:match-checkpoint:v2', '{"tick":3}');
    localStorage.setItem('pitch-legends:quick:v1', '{"homeIndex":2}');
    localStorage.setItem('another-app', 'untouched');

    const store = await openStore(factory);
    expect(store.backend()).toBe('indexeddb');
    expect(store.get('pitch-legends:save:v6')).toBe('{"career":1}');
    expect(store.get('pitch-legends:quick:v1')).toBe('{"homeIndex":2}');
    await store.flush();
    expect(Object.keys(localStorage)).toEqual(['another-app']);
    expect(await onDisk(factory, 'career', 'pitch-legends:save:v6')).toBe('{"career":1}');
    expect(await onDisk(factory, 'legends', 'pitch-legends:legends:v1')).toBe('{"legends":1}');
    expect(await onDisk(factory, 'checkpoints', 'pitch-legends:match-checkpoint:v2')).toBe('{"tick":3}');
    expect(await onDisk(factory, 'career', 'pitch-legends:legends:v1')).toBeUndefined();

    const reopened = await openStore(factory);
    expect(reopened.get('pitch-legends:legends:v1')).toBe('{"legends":1}');
  });

  it('reports a full disk and commits nothing of a failed batch', async () => {
    const factory = new IDBFactory();
    const store = await openStore(factory);
    await store.batch([{ key: CAREER_KEY, value: 'career-A' }, { key: MATCH_CHECKPOINT_KEY, value: 'checkpoint-A' }]);

    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Disk full', 'QuotaExceededError'); });
    const result = await store.batch([{ key: MATCH_CHECKPOINT_KEY, value: null }, { key: CAREER_KEY, value: 'career-B' }]);
    expect(result).toMatchObject({ ok: false, reason: 'quota' });
    expect(store.issue()?.reason).toBe('quota');
    // The session keeps playing with the newest state …
    expect(store.get(CAREER_KEY)).toBe('career-B');
    // … but the disk still holds the last complete pair.
    expect(await onDisk(factory, 'career', CAREER_KEY)).toBe('career-A');
    expect(await onDisk(factory, 'checkpoints', MATCH_CHECKPOINT_KEY)).toBe('checkpoint-A');

    vi.restoreAllMocks();
    expect((await store.set(CAREER_KEY, 'career-C')).ok).toBe(true);
    expect(store.issue()).toBeNull();
  });

  it('rolls a localStorage batch back when the quota is hit', async () => {
    const store = await openStore(null);
    expect(store.backend()).toBe('localstorage');
    localStorage.setItem(MATCH_CHECKPOINT_KEY, 'checkpoint-A');
    localStorage.setItem(CAREER_KEY, 'career-A');
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (value === 'career-B') throw new DOMException('Disk full', 'QuotaExceededError');
      original.call(this, key, value);
    });
    const result = await store.batch([{ key: MATCH_CHECKPOINT_KEY, value: null }, { key: CAREER_KEY, value: 'career-B' }]);
    expect(result).toMatchObject({ ok: false, reason: 'quota' });
    expect(localStorage.getItem(MATCH_CHECKPOINT_KEY)).toBe('checkpoint-A');
    expect(localStorage.getItem(CAREER_KEY)).toBe('career-A');
    expect(store.issue()?.reason).toBe('quota');
  });

  it('never drops a damaged career: it is kept, reported and the last good backup can be loaded', async () => {
    await openStore(null);
    localStorage.setItem(CAREER_KEY, '{"version":6,"clubId":');
    const gs = TestBed.inject(GameStateService);
    expect(gs.loadFromStorage()).toBe(false);
    expect(gs.loadIssue()).toEqual({ status: 'corrupt', reason: 'parse', hasBackup: false });
    expect(localStorage.getItem(CAREER_KEY)).toBe('{"version":6,"clubId":');
    expect(localStorage.getItem(CORRUPT_BACKUP_KEY)).toBe('{"version":6,"clubId":');

    const good = createNewGame({ managerName: 'Backup', clubName: 'Safe FC', seed: 77 });
    localStorage.setItem(LAST_GOOD_BACKUP_KEY, JSON.stringify(good));
    expect(gs.loadFromStorage()).toBe(false);
    expect(gs.loadIssue()?.hasBackup).toBe(true);
    expect(gs.restoreBackup()).toBe(true);
    expect(gs.game()?.clubId).toBe(good.clubId);
    expect(gs.loadIssue()).toBeNull();
    expect(JSON.parse(localStorage.getItem(CAREER_KEY)!).clubId).toBe(good.clubId);
  });

  it('reports a structurally invalid save instead of loading or deleting it', async () => {
    await openStore(null);
    const broken = { ...createNewGame({ managerName: 'Bad', clubName: 'Bad FC', seed: 5 }), teams: [] };
    localStorage.setItem(CAREER_KEY, JSON.stringify(broken));
    const saves = TestBed.inject(SaveService);
    expect(saves.load()).toMatchObject({ status: 'corrupt', reason: 'invalid' });
    expect(saves.hasSave()).toBe(true);
  });

  it('migrates version 5 to 6, keeping identities and a copy of the original', async () => {
    const factory = new IDBFactory();
    const legacy = olderSave(5);
    const raw = JSON.stringify(legacy);
    localStorage.setItem('pitch-legends:save:v5', raw);
    const store = await openStore(factory);
    const result = TestBed.inject(SaveService).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.migratedFrom).toBe(5);
    expect(result.state.version).toBe(6);
    expect(result.state.clubId).toBe(legacy.clubId);
    expect(result.state.manager.id).toBe(legacy.manager.id);
    const before = legacy.teams.flatMap((team) => team.players.map((player) => player.id)).sort();
    const after = result.state.teams.filter((team) => legacy.league.teamIds.includes(team.id)).flatMap((team) => team.players.map((player) => player.id)).sort();
    expect(after).toEqual(before);
    expect(result.state.otherLeagues).toHaveLength(1);
    expect(result.state.cup).toBeTruthy();
    await store.flush();
    expect(store.get(migrationBackupKey(5))).toBe(raw);
    expect(store.has('pitch-legends:save:v5')).toBe(false);
    expect(JSON.parse(String(await onDisk(factory, 'career', CAREER_KEY))).version).toBe(6);
    expect(await onDisk(factory, 'backups', migrationBackupKey(5))).toBe(raw);
  });

  it('stores the finished match and drops its checkpoint in the same write', async () => {
    const factory = new IDBFactory();
    const store = await openStore(factory);
    const gs = TestBed.inject(GameStateService);
    gs.newGame({ managerName: 'Atomic', clubName: 'Atomic FC', seed: 31 });
    await store.set(MATCH_CHECKPOINT_KEY, '{"tick":10}');
    gs.mutate((draft) => { draft.managerName = 'Committed'; });
    const batch = vi.spyOn(store, 'batch');
    const result = await gs.persistWith(TestBed.inject(MatchCheckpointService).takeClearOperations());
    expect(result.ok).toBe(true);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0].map((operation) => operation.key)).toEqual(expect.arrayContaining([CAREER_KEY, MATCH_CHECKPOINT_KEY]));
    expect(await onDisk(factory, 'checkpoints', MATCH_CHECKPOINT_KEY)).toBeUndefined();
    expect(JSON.parse(String(await onDisk(factory, 'career', CAREER_KEY))).managerName).toBe('Committed');
  });

  it('builds export file names every system accepts', () => {
    expect(exportFileName('Jürgen / O’Neil:*?', 2)).toBe('pitch-legends-jurgen-o-neil-s2.json');
    expect(exportFileName('   ', 0)).toBe('pitch-legends-career-s1.json');
    expect(exportFileName('../../etc/passwd', 3)).toBe('pitch-legends-etc-passwd-s3.json');
  });
});

describe('Platform: control bindings and touch layout', () => {
  afterEach(() => { localStorage.clear(); TestBed.resetTestingModule(); });

  it('swaps keys instead of binding one key twice, and refuses reserved keys and arrows', () => {
    const prefs = defaultControlPrefs();
    const bound = bindKey(prefs, 'pass', 'KeyL');
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(keysFor(bound.prefs, 'pass')).toEqual(['KeyL']);
    expect(bound.swappedWith).toBe('shoot');
    expect(keysFor(bound.prefs, 'shoot')).toEqual(['KeyJ']);
    expect(bindKey(prefs, 'pass', 'Escape')).toEqual({ ok: false, reason: 'reserved' });
    expect(bindKey(prefs, 'pass', 'KeyQ')).toEqual({ ok: false, reason: 'reserved' });
    expect(bindKey(prefs, 'shoot', 'ArrowUp')).toEqual({ ok: false, reason: 'arrow' });
  });

  it('keeps the arrow keys when movement is rebound', () => {
    const moved = bindKey(defaultControlPrefs(), 'move-up', 'KeyI');
    expect(moved.ok && keysFor(moved.prefs, 'move-up')).toEqual(['KeyI', 'ArrowUp']);
    expect(moved.ok && moved.swappedWith).toBe('skill');
    expect(moved.ok && primaryKey(moved.prefs, 'skill')).toBe('KeyW');
  });

  it('swaps gamepad buttons the same way', () => {
    const { prefs, swappedWith } = bindButton(defaultControlPrefs(), 'shoot', 0);
    expect(swappedWith).toBe('pass');
    expect(prefs.gamepad).toEqual({ shoot: 0, pass: 1 });
  });

  it('clamps stored touch layouts and ignores garbage', () => {
    const prefs = normaliseControlPrefs({ keyboard: { pass: 'Escape', shoot: 'KeyP', nonsense: 'KeyZ' }, gamepad: { pass: -4, lob: 9 }, touch: { scale: 9, opacity: 0, lift: 'x', leftHanded: true } });
    expect(prefs.keyboard).toEqual({ shoot: 'KeyP' });
    expect(prefs.gamepad).toEqual({ lob: 9 });
    expect(prefs.touch).toEqual({ scale: 1.5, opacity: 0.4, lift: 0, leftHanded: true });
    expect(normaliseControlPrefs('broken')).toEqual(defaultControlPrefs());
  });

  it('remembers bindings per device, outside any career', async () => {
    await openStore(null);
    const service = TestBed.inject(ControlPrefsService);
    const bound = bindKey(service.prefs(), 'sprint', 'KeyN');
    if (bound.ok) service.update(bound.prefs);
    expect(JSON.parse(localStorage.getItem(CONTROL_PREFS_KEY)!).keyboard.sprint).toBe('KeyN');
    await openStore(null);
    expect(keysFor(TestBed.inject(ControlPrefsService).prefs(), 'sprint')).toEqual(['KeyN']);
    expect(Object.keys(localStorage).some((key) => key.startsWith('pitch-legends:save'))).toBe(false);
  });
});
