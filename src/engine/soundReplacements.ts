// Replacement sounds tried out in this browser (ShipArt → Sounds, docs/SOUND-TOOL.md).
//
// A sound file dropped on a sound in ShipArt is kept here (IndexedDB, per site address) and
// used at once in ShipArt's preview. With "Use them in the game" on, the game uses them too, in
// this browser only. Nobody else hears them: they reach the game for everyone when they're
// handed over as a zip and written into the game files on the dev copy.

export interface Replacement {
  /** The sound it replaces ("sfx.explosion.t3"). */
  name: string;
  /** The dropped file's own name ("boom final.wav"). */
  fileName: string;
  /** Its file type ("audio/wav"), and its contents. */
  type: string;
  data: ArrayBuffer;
  /** When it was dropped (Date.now()). */
  addedAt: number;
}

const DB = 'fleet-game.sounds';
const STORE = 'replacements';
const IN_GAME = 'fleet-game.sound-replacements-in-game';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Every replacement kept in this browser (none if storage is blocked). */
export async function listReplacements(): Promise<Replacement[]> {
  try {
    return await run('readonly', (s) => s.getAll() as IDBRequest<Replacement[]>);
  } catch {
    return [];
  }
}

export const putReplacement = (r: Replacement) => run('readwrite', (s) => s.put(r));
export const deleteReplacement = (name: string) => run('readwrite', (s) => s.delete(name));

/** Whether the game uses this browser's replacements too. */
export function replacementsInGame() {
  try {
    return localStorage.getItem(IN_GAME) === 'on';
  } catch {
    return false;
  }
}

export function setReplacementsInGame(on: boolean) {
  try {
    localStorage.setItem(IN_GAME, on ? 'on' : 'off');
  } catch {
    // Storage blocked: not remembered.
  }
}
