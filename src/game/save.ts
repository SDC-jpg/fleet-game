// Saving your equipment in this browser, so it carries over between games and
// page reloads. Each save is marked with the game's version (build) number.
// Saves from SAVES_KEPT_FROM onward are kept; older ones are ignored, so a
// version that changes gameplay can start everyone fresh.

import { CONFIG } from './config';
import { MAX_MERGE_LEVEL, defaultMergeAllow, gearscore, unlockSlots, updateBonuses, type Item } from './equipment';
import { RARITY_ORDER, type Rarity } from './rarity';
import type { GameState } from './world';

/** The version number of this build (set by the GitHub publish; "dev" when running locally). */
export const BUILD: string = import.meta.env.VITE_BUILD || 'dev';

/**
 * The first build whose saved equipment still loads. Builds that don't touch
 * gameplay keep it (so players keep their items); when a build changes
 * gameplay, set this to that build's number so everyone starts fresh.
 */
export const SAVES_KEPT_FROM = 20;

/** True if equipment saved by `build` loads in this build ("dev" only loads "dev" saves). */
const keepsSaveFrom = (build: unknown) =>
  BUILD === 'dev' ? build === 'dev' : Number(build) >= SAVES_KEPT_FROM && Number(build) <= Number(BUILD);

const KEY = 'fleet-game.equipment';

/**
 * The save layout. 1 (no number written): 4 rarities, "rare" = gold, "epic" =
 * purple. 2: 7 rarities ("superior" was "rare", "rare" was "epic"), loot count, Merge Module.
 */
const FORMAT = 2;

interface SavedEquipment {
  format?: number;
  build: string;
  items: Item[];
  slots: (number | null)[];
  unlockedTier: number;
  /** Items picked up in every run so far. */
  looted?: number;
  /** Has the Merge Module (older saves only have this). */
  mergeModule?: boolean;
  /** Merge Module level: 1 = Merge Module, 2–4 = Mk. II–IV. */
  mergeLevel?: number;
  /** Rarities QuickMerge and AutoMerge may use. */
  mergeAllow?: Rarity[];
  /** AutoMerge switched on. */
  autoMerge?: boolean;
  /** Gearscore of the equipped items when saved (older saves don't have it; it's worked out again on load anyway). */
  gearscore?: number;
}

/** Old rarity names → their tier in the 7-tier scale (format 1 saves). */
const FORMAT_1_RARITIES: Record<string, Rarity> = { common: 'common', uncommon: 'uncommon', rare: 'superior', epic: 'rare' };

/** Bring an older save up to date (same items and bonuses, new rarity names). */
function upgradeSave(data: SavedEquipment): SavedEquipment {
  if ((data.format ?? 1) >= FORMAT) return data;
  return {
    ...data,
    format: FORMAT,
    items: data.items.map((it) => ({ ...it, rarity: FORMAT_1_RARITIES[it.rarity] ?? 'common' })),
    // Older saves didn't count loot: start from what's in the inventory.
    looted: data.looted ?? data.items.length,
  };
}

/** Save your items, which slot each is in, and your unlocked slots. */
export function saveEquipment(state: GameState) {
  const data: SavedEquipment = {
    format: FORMAT,
    build: BUILD,
    items: state.items,
    slots: state.slots,
    unlockedTier: state.unlockedTier,
    looted: state.looted,
    mergeModule: state.mergeLevel > 0,
    mergeLevel: state.mergeLevel,
    mergeAllow: state.mergeAllow,
    autoMerge: state.autoMerge,
    gearscore: gearscore(state),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage blocked or full (e.g. a private window): equipment just won't carry over.
  }
}

/**
 * Clear your saved progress: every item, the slot layout, unlocked slot tiers,
 * the loot count and the Merge Module, both in this game and in the browser.
 * The run log and settings stay.
 */
export function clearEquipment(state: GameState) {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: nothing was saved anyway.
  }
  state.items = [];
  state.slots = state.slots.map(() => null);
  state.unlockedTier = 1;
  state.looted = 0;
  state.mergeLevel = 0;
  state.mergeAllow = defaultMergeAllow();
  state.autoMerge = false;
  state.found = null;
  // Slots of tiers reached in this run open again, as they would have anyway.
  unlockSlots(state);
  updateBonuses(state);
  for (const s of state.playerFleet.members) s.hp = Math.min(s.hp, s.stats.maxHp);
  state.equipmentChanged = true;
}

/** Load saved equipment into a new game, if there is any from this version. */
export function loadEquipment(state: GameState) {
  let data: SavedEquipment;
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return;
    data = upgradeSave(JSON.parse(text));
  } catch {
    return;
  }
  if (!keepsSaveFrom(data.build) || !Array.isArray(data.items) || !Array.isArray(data.slots)) return;
  state.items = data.items.filter((it) => RARITY_ORDER.includes(it.rarity));
  state.looted = Math.max(0, data.looted ?? 0);
  // Saves from before Merge Mk. II only say whether you had the Merge Module.
  state.mergeLevel = Math.min(MAX_MERGE_LEVEL, Math.max(0, data.mergeLevel ?? (data.mergeModule ? 1 : 0)));
  if (Array.isArray(data.mergeAllow)) state.mergeAllow = data.mergeAllow.filter((r) => RARITY_ORDER.includes(r));
  state.autoMerge = !!data.autoMerge;
  const ids = new Set(state.items.map((it) => it.id));
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
