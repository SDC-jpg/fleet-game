// Equipment: items dropped by destroyed enemies. Each gives your whole fleet
// one bonus (damage, fire rate, health...). You equip them on the pause screen
// (Esc), in slots unlocked by the biggest tier you've reached (3 per tier).
// Like world.ts, nothing is drawn here.

import { distSq, randRange } from '../engine/math';
import { CONFIG, ITEM_STATS, RARITIES, type ItemStat, type Rarity } from './config';
import { addSound, statsFor, tierValue, type GameState, type Ship } from './world';

export interface Item {
  id: number;
  stat: ItemStat;
  rarity: Rarity;
  /** Its bonus: 0.08 = +8%. */
  amount: number;
}

/** An item floating in space until one of your ships flies over it. */
export interface Loot {
  item: Item;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds before it disappears. */
  life: number;
}

/** All bonuses for your whole fleet, as multipliers (1 = none, 1.1 = +10%). */
export type FleetBonus = Record<ItemStat, number>;

export const noBonus = (): FleetBonus => ({ damage: 1, fireRate: 1, health: 1, speed: 1, stamina: 1, boostSpeed: 1, skillRate: 1 });

const STATS = Object.keys(ITEM_STATS) as ItemStat[];
const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic'];

/** The tier a slot belongs to (slots 0–2 = tier 1, 3–5 = tier 2...). */
export const slotTier = (slot: number) => Math.floor(slot / CONFIG.items.slotsPerTier) + 1;

/** Whether a slot is unlocked (its tier has been reached). */
export const slotUnlocked = (state: GameState, slot: number) => slotTier(slot) <= state.unlockedTier;

/** Unlock the slots of the biggest tier you've reached (up to CONFIG.items.maxSlotTier). */
export function unlockSlots(state: GameState) {
  const tier = Math.min(state.maxTier, CONFIG.items.maxSlotTier);
  if (tier > state.unlockedTier) {
    state.unlockedTier = tier;
    state.equipmentChanged = true;
  }
}

/** The slot an item is in, or -1 if it's not equipped. */
export const slotOf = (state: GameState, id: number) => state.slots.indexOf(id);

/** The first empty unlocked slot, or -1 if there's none. */
const freeSlot = (state: GameState) => state.slots.findIndex((id, i) => id === null && slotUnlocked(state, i));

/** Normal rarity odds (the same as cards). */
const normalWeights = (): Record<Rarity, number> => {
  const R = CONFIG.rarity;
  return { common: R.commonWeight, uncommon: R.uncommonWeight, rare: R.rareWeight, epic: R.epicWeight };
};

/** A new random item: random stat, rarity rolled with the given odds (normally the same as cards). */
export function rollItem(state: GameState, weights = normalWeights()): Item {
  const R = CONFIG.rarity;
  // Rarer items scale up like card bonuses do (Epic ≈ 3.2× Common).
  const scale = { common: 1, uncommon: R.uncommonBonus / R.commonBonus, rare: R.rareBonus / R.commonBonus, epic: R.epicBonus / R.commonBonus };
  let roll = Math.random() * RARITY_ORDER.reduce((sum, k) => sum + weights[k], 0);
  const rarity = RARITY_ORDER.find((k) => (roll -= weights[k]) < 0) ?? 'common';
  const stat = STATS[Math.floor(Math.random() * STATS.length)];
  const base = CONFIG.items[`${stat}Bonus`];
  const amount = base * scale[rarity] * (1 + randRange(-R.spread, R.spread));
  return { id: state.nextId++, stat, rarity, amount: Math.round(amount * 100) / 100 };
}

/** A destroyed enemy sometimes drops an item (bigger enemies more often). */
export function maybeDropItem(state: GameState, s: Ship) {
  const I = CONFIG.items;
  const chance = I.dropChance * tierValue(s.tier) ** I.dropChanceGrowth;
  if (Math.random() < chance) dropItem(state, s);
}

/** Drop an item where ship `s` was, with the given rarity odds (normal ones by default). */
export function dropItem(state: GameState, s: Ship, weights = normalWeights()) {
  const a = Math.random() * Math.PI * 2;
  state.loot.push({ item: rollItem(state, weights), x: s.x, y: s.y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: CONFIG.items.lifetime });
}

/** Loot drifts, is pulled toward your ships when close, and is picked up by any of them. */
export function updateLoot(state: GameState, dt: number) {
  for (const l of state.loot) {
    let nearest: Ship | null = null;
    let nearestD = Infinity;
    for (const s of state.playerFleet.members) {
      const d = distSq(s.x, s.y, l.x, l.y);
      if (d < nearestD) {
        nearestD = d;
        nearest = s;
      }
    }
    if (nearest && nearestD < (CONFIG.wreckMagnetRange + nearest.stats.radius) ** 2) {
      const d = Math.sqrt(nearestD) || 1;
      l.vx += ((nearest.x - l.x) / d) * CONFIG.wreckMagnetAccel * dt;
      l.vy += ((nearest.y - l.y) / d) * CONFIG.wreckMagnetAccel * dt;
    } else {
      l.vx *= 1 - Math.min(1, dt);
      l.vy *= 1 - Math.min(1, dt);
    }
    l.x += l.vx * dt;
    l.y += l.vy * dt;
    l.life -= dt;
    if (nearest && nearestD < (nearest.stats.radius + 8) ** 2) {
      state.items.push(l.item);
      state.equipmentChanged = true;
      state.found = { item: l.item, time: state.time };
      l.life = 0;
      addSound(state, 'sfx.loot', l, 1, 1, true);
      // Fill an empty slot straight away, so a new item helps without a trip to the menu.
      equip(state, l.item.id);
    }
  }
  state.loot = state.loot.filter((l) => l.life > 0);
}

/**
 * Put an item into a slot. With no slot given, the first empty unlocked one.
 * If the slot holds another item, the two swap: the other one goes where this
 * one was (another slot, or the inventory). Returns false if nothing changed.
 */
export function equip(state: GameState, id: number, slot = freeSlot(state)) {
  if (slot < 0 || slot >= state.slots.length || !slotUnlocked(state, slot)) return false;
  if (!state.items.some((it) => it.id === id)) return false;
  const from = slotOf(state, id);
  if (from === slot) return false;
  const other = state.slots[slot];
  state.slots[slot] = id;
  if (from >= 0) state.slots[from] = other;
  state.equipmentChanged = true;
  updateBonuses(state);
  return true;
}

/** Take an item out of its slot (it stays in your inventory). */
export function unequip(state: GameState, id: number) {
  const slot = slotOf(state, id);
  if (slot < 0) return;
  state.slots[slot] = null;
  state.equipmentChanged = true;
  updateBonuses(state);
}

/**
 * Work out the fleet's bonuses from cards and equipped items, and give every
 * ship of yours its new max health (keeping the same share of health it had).
 */
export function updateBonuses(state: GameState) {
  const b = noBonus();
  b.damage += state.cardBonus.damage;
  b.fireRate += state.cardBonus.fireRate;
  state.slots.forEach((id, slot) => {
    if (id === null || !slotUnlocked(state, slot)) return;
    const it = state.items.find((i) => i.id === id);
    if (it) b[it.stat] += it.amount;
  });
  state.bonus = b;
  for (const s of state.playerFleet.members) {
    const share = s.hp / s.stats.maxHp;
    s.stats.maxHp = Math.round(statsFor(s.type, s.team, s.tier).maxHp * b.health);
    s.hp = share * s.stats.maxHp;
  }
}

/** "Rare Autoloader", "+14% fire rate", its icon and its rarity's colour. */
export function describeItem(it: Item) {
  const s = ITEM_STATS[it.stat];
  const r = RARITIES[it.rarity];
  return { name: `${r.name} ${s.name}`, bonus: `+${Math.round(it.amount * 100)}% ${s.bonus}`, icon: s.icon, color: r.color };
}
