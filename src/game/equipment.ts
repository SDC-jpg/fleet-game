// Equipment: items dropped by destroyed enemies. Each gives your whole fleet
// one bonus (damage, fire rate, health...). You equip them on the pause screen
// (Esc), in slots unlocked by the biggest tier you've reached (3 per tier).
// Like world.ts, nothing is drawn here.

import { distSq, randRange } from '../engine/math';
import { CONFIG, ITEM_STATS, SKILLS, enabledSkills, skillEnabled, type ItemStat, type SkillId, type SkillStat } from './config';
import { MAX_RARITY, nextRarity, rarityAt, rarityInfo, rarityScale, rarityTier, rarityWeights, rollRarity, rollSpread, roundBonus, type Rarity, type RarityWeights } from './rarity';
import { addMod, rankAmount, skillStats, upgradeText } from './upgrades';
import { addEffect, addSound, statsFor, tierValue, type GameState, type Ship } from './world';

export interface Item {
  id: number;
  stat: ItemStat;
  rarity: Rarity;
  /** Its bonus: 0.08 = +8%. */
  amount: number;
  /** Merge rank of a top-rarity item ("+2 Mythic Afterburner"): its bonuses are × (1 + plusBonus × plus). */
  plus?: number;
  /** Extra Damage or Hitpoints bonuses (Legendary items have 1, Mythic 2). */
  subs?: SubStat[];
  /** A level-up card's bonus carried by some Mythic items. */
  card?: ItemCard;
}

/** An extra bonus on a Legendary or Mythic item. */
export interface SubStat {
  stat: 'damage' | 'health';
  amount: number;
}

/** A level-up card's bonus on an item: fleet damage or fire rate, or a skill upgrade (only while you have that skill). */
export type ItemCard = { kind: 'damage' | 'fireRate'; amount: number } | { kind: 'skill'; skill: SkillId; stat: SkillStat; amount: number };

/** Something lying in space for your ships to fly over. */
export interface Loot {
  /** An item, or a quality-of-life drop (it never disappears and drifts toward you). */
  item?: Item;
  qol?: QolDrop;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds before it disappears (Infinity for quality-of-life drops). */
  life: number;
}

/** Quality-of-life drops: unlock a feature when picked up. */
export type QolDrop = 'merge-module';

/** All bonuses for your whole fleet, as multipliers (1 = none, 1.1 = +10%). */
export type FleetBonus = Record<ItemStat, number>;

export const noBonus = (): FleetBonus => ({ damage: 1, fireRate: 1, health: 1, speed: 1, stamina: 1, boostSpeed: 1, skillRate: 1 });

const STATS = Object.keys(ITEM_STATS) as ItemStat[];
const SUB_STATS: SubStat['stat'][] = ['damage', 'health'];
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

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

/** Gearscore: the rarity tiers (Common 1 … Mythic 7) of every equipped item, added up. */
export function gearscore(state: GameState) {
  const equipped = new Set(state.slots);
  return state.items.reduce((sum, it) => sum + (equipped.has(it.id) ? rarityTier(it.rarity) : 0), 0);
}

/** The first empty unlocked slot, or -1 if there's none. */
const freeSlot = (state: GameState) => state.slots.findIndex((id, i) => id === null && slotUnlocked(state, i));

/** A random level-up card bonus for a Mythic item: any card's effect except Repairs (which only works once). */
function rollItemCard(): ItemCard {
  const C = CONFIG.cards;
  const options: (() => ItemCard)[] = [
    () => ({ kind: 'damage', amount: C.damageBonus }),
    () => ({ kind: 'fireRate', amount: C.fireRateBonus }),
    ...enabledSkills().flatMap((skill) =>
      skillStats(skill).map((stat) => () => ({ kind: 'skill', skill, stat, amount: rankAmount(stat, rollRarity()) }) as ItemCard),
    ),
  ];
  return pick(options)();
}

/**
 * A new random item: random stat; rarity rolled with the given odds (normally
 * the same as cards) unless one is given. Legendary and Mythic items get
 * substats, rolled like an item one rarity lower; some Mythic items carry a
 * card bonus. `plus` ("+N", top rarity only) multiplies the bonuses.
 */
export function rollItem(state: GameState, opts: { weights?: RarityWeights; rarity?: Rarity; plus?: number } = {}): Item {
  const I = CONFIG.items;
  const rarity = opts.rarity ?? rollRarity(opts.weights ?? rarityWeights());
  const plus = rarity === MAX_RARITY ? (opts.plus ?? 0) : 0;
  const boost = 1 + I.plusBonus * plus;
  const roll = (stat: ItemStat, r: Rarity) => roundBonus(I[`${stat}Bonus`] * rarityScale(r) * rollSpread() * boost);
  const stat = pick(STATS);
  const item: Item = { id: state.nextId++, stat, rarity, amount: roll(stat, rarity) };
  if (plus > 0) item.plus = plus;
  const subCount = rarity === 'mythic' ? I.mythicSubstats : rarity === 'legendary' ? I.legendarySubstats : 0;
  if (subCount > 0) {
    const below = rarityAt(rarityTier(rarity) - 1);
    // The same type can come up more than once.
    item.subs = Array.from({ length: subCount }, () => {
      const sub = pick(SUB_STATS);
      return { stat: sub, amount: roll(sub, below) };
    });
  }
  if (rarity === 'mythic' && Math.random() < I.mythicCardChance) item.card = rollItemCard();
  return item;
}

/** A destroyed enemy sometimes drops an item (bigger enemies more often); the Merge Module once you've looted enough. */
export function maybeDropItem(state: GameState, s: Ship) {
  const I = CONFIG.items;
  if (wantsMergeModule(state)) dropQol(state, s, 'merge-module');
  const chance = I.dropChance * tierValue(s.tier) ** I.dropChanceGrowth;
  if (Math.random() < chance) dropItem(state, s);
}

/** True when the Merge Module should drop: enough items looted, not owned yet, and not already floating somewhere. */
const wantsMergeModule = (state: GameState) =>
  !state.mergeModule && state.looted >= CONFIG.items.mergeModuleAfter && !state.loot.some((l) => l.qol === 'merge-module');

/** Drop an item where ship `s` was, with the given rarity odds (normal ones by default). */
export function dropItem(state: GameState, s: Ship, weights = rarityWeights()) {
  const a = Math.random() * Math.PI * 2;
  state.loot.push({ item: rollItem(state, { weights }), x: s.x, y: s.y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: CONFIG.items.lifetime });
}

/** Drop a quality-of-life item (it stays until picked up and drifts toward you). */
function dropQol(state: GameState, s: Ship, qol: QolDrop) {
  state.loot.push({ qol, x: s.x, y: s.y, vx: 0, vy: 0, life: Infinity });
}

/**
 * Loot drifts, is pulled toward your ships when close, and is picked up by any
 * of them. Quality-of-life drops also drift gently toward you from anywhere,
 * and shimmer.
 */
export function updateLoot(state: GameState, dt: number) {
  const I = CONFIG.items;
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
    } else if (l.qol && nearest) {
      // A gentle, steady pull from anywhere, so it always reaches you in the end.
      const d = Math.sqrt(nearestD) || 1;
      l.vx += (((nearest.x - l.x) / d) * I.qolDriftSpeed - l.vx) * Math.min(1, dt);
      l.vy += (((nearest.y - l.y) / d) * I.qolDriftSpeed - l.vy) * Math.min(1, dt);
    } else {
      l.vx *= 1 - Math.min(1, dt);
      l.vy *= 1 - Math.min(1, dt);
    }
    l.x += l.vx * dt;
    l.y += l.vy * dt;
    l.life -= dt;
    // Quality-of-life drops shimmer: a sparkle now and then around them.
    if (l.qol && Math.random() < dt * 8) addEffect(state, 'vfx.shimmer', l.x + randRange(-12, 12), l.y + randRange(-12, 12), 0, 1);
    if (nearest && nearestD < (nearest.stats.radius + 8) ** 2) {
      l.life = 0;
      addSound(state, 'sfx.loot', l, 1, 1, true);
      if (l.qol) pickUpQol(state, l.qol);
      else if (l.item) pickUpItem(state, l.item);
    }
  }
  state.loot = state.loot.filter((l) => l.life > 0);
}

function pickUpItem(state: GameState, item: Item) {
  state.items.push(item);
  state.looted++;
  state.equipmentChanged = true;
  state.found = { item, time: state.time };
  // Fill an empty slot straight away, so a new item helps without a trip to the menu.
  equip(state, item.id);
}

/** A quality-of-life drop unlocks its feature (the game shows it: see Game.ts). */
function pickUpQol(state: GameState, qol: QolDrop) {
  if (qol === 'merge-module') state.mergeModule = true;
  state.equipmentChanged = true;
  state.unlocked = qol;
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
 * Work out the fleet's bonuses from cards and equipped items (main bonus,
 * substats, and Mythic card bonuses), and give every ship of yours its new
 * max health (keeping the same share of health it had).
 */
export function updateBonuses(state: GameState) {
  const b = noBonus();
  b.damage += state.cardBonus.damage;
  b.fireRate += state.cardBonus.fireRate;
  const skills: GameState['skillBonus'] = {};
  state.slots.forEach((id, slot) => {
    if (id === null || !slotUnlocked(state, slot)) return;
    const it = state.items.find((i) => i.id === id);
    if (!it) return;
    b[it.stat] += it.amount;
    for (const sub of it.subs ?? []) b[sub.stat] += sub.amount;
    const c = it.card;
    // A bonus for a switched-off skill does nothing (and isn't shown).
    if (c?.kind === 'skill') {
      if (skillEnabled(c.skill)) addMod((skills[c.skill] ??= {}), c.stat, c.amount);
    } else if (c) b[c.kind] += c.amount;
  });
  state.bonus = b;
  state.skillBonus = skills;
  for (const s of state.playerFleet.members) {
    const share = s.hp / s.stats.maxHp;
    s.stats.maxHp = Math.round(statsFor(s.type, s.team, s.tier).maxHp * b.health);
    s.hp = share * s.stats.maxHp;
  }
}

// ---------- Merging (Merge Module) ----------

/** Whether two items can be merged together: the same rarity and the same "+N". */
export const sameMergeGroup = (a: Item, b: Item) => a.rarity === b.rarity && (a.plus ?? 0) === (b.plus ?? 0);

/** Items merged at once. */
export const MERGE_COUNT = 3;

/**
 * Merge three items of the same rarity and "+N" (none equipped) into one
 * random item: of the next rarity up, or for top-rarity items, the same rarity
 * one "+N" higher. Needs the Merge Module. Returns the new item, or null if
 * the merge isn't allowed.
 */
export function mergeItems(state: GameState, ids: number[]): Item | null {
  if (!state.mergeModule || ids.length !== MERGE_COUNT || new Set(ids).size !== MERGE_COUNT) return null;
  const items = ids.map((id) => state.items.find((it) => it.id === id));
  if (items.some((it) => !it || slotOf(state, it.id) >= 0)) return null;
  const [first, ...rest] = items as Item[];
  if (!rest.every((it) => sameMergeGroup(first, it))) return null;
  const top = first.rarity === MAX_RARITY;
  const result = top ? rollItem(state, { rarity: MAX_RARITY, plus: (first.plus ?? 0) + 1 }) : rollItem(state, { rarity: nextRarity(first.rarity) });
  state.items = state.items.filter((it) => !ids.includes(it.id));
  state.items.push(result);
  state.equipmentChanged = true;
  addSound(state, 'sfx.merge', { x: 0, y: 0 }, 1, 1, true);
  return result;
}

// ---------- Describing items ----------

/** "+15% damage", "+12% max health": one bonus in words. */
const bonusText = (stat: ItemStat, amount: number) => `+${Math.round(amount * 100)}% ${ITEM_STATS[stat].bonus}`;

/** A Mythic item's card bonus in words: "+10% damage (card)", "Missiles: +2 missiles". */
function cardText(c: ItemCard) {
  if (c.kind === 'skill') return `${SKILLS[c.skill].name}: ${upgradeText(c.skill, c.stat, c.amount)}`;
  return `${bonusText(c.kind, c.amount)} (card)`;
}

/** "+1 Mythic Afterburner", "+14% fire rate", extra lines (substats, card bonus), its icon and its rarity's colour. */
export function describeItem(it: Item) {
  const s = ITEM_STATS[it.stat];
  const r = rarityInfo(it.rarity);
  return {
    name: `${it.plus ? `+${it.plus} ` : ''}${r.name} ${s.name}`,
    bonus: bonusText(it.stat, it.amount),
    extra: [
      ...(it.subs ?? []).map((sub) => bonusText(sub.stat, sub.amount)),
      ...(it.card && (it.card.kind !== 'skill' || skillEnabled(it.card.skill)) ? [cardText(it.card)] : []),
    ],
    icon: s.icon,
    color: r.color,
    holo: !!r.holo,
  };
}
