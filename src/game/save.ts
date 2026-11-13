// Saving your equipment in this browser, so it carries over between games and
// page reloads. Each save is marked with the game's version (build) number: a
// new version ignores equipment saved by an older one.

import { CONFIG } from './config';
import { updateBonuses, type Item } from './equipment';
import type { GameState } from './world';

/** The version number of this build (set by the GitHub publish; "dev" when running locally). */
export const BUILD: string = import.meta.env.VITE_BUILD || 'dev';

const KEY = 'fleet-game.equipment';

interface SavedEquipment {
  build: string;
  items: Item[];
  slots: (number | null)[];
  unlockedTier: number;
}

/** Save your items, which slot each is in, and your unlocked slots. */
export function saveEquipment(state: GameState) {
  const data: SavedEquipment = { build: BUILD, items: state.items, slots: state.slots, unlockedTier: state.unlockedTier };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage blocked or full (e.g. a private window): equipment just won't carry over.
  }
}

/** Load saved equipment into a new game, if there is any from this version. */
export function loadEquipment(state: GameState) {
  let data: SavedEquipment;
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return;
    data = JSON.parse(text);
  } catch {
    return;
  }
  if (data.build !== BUILD || !Array.isArray(data.items) || !Array.isArray(data.slots)) return;
  state.items = data.items;
  const ids = new Set(data.items.map((it) => it.id));
  // Keep the slot layout (ignoring anything that doesn't match an item).
  state.slots = state.slots.map((_, i) => {
    const id = data.slots[i];
    return typeof id === 'number' && ids.has(id) ? id : null;
  });
  state.unlockedTier = Math.min(CONFIG.items.maxSlotTier, Math.max(1, data.unlockedTier | 0));
  // New items, ships... get numbers after the saved items', so none share a number.
  state.nextId = Math.max(state.nextId, ...data.items.map((it) => it.id + 1));
  updateBonuses(state);
  // The flagship starts at full health with its equipment bonus.
  for (const s of state.playerFleet.members) s.hp = s.stats.maxHp;
}
