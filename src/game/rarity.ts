// Rarity: shared by level-up cards and equipment. Seven tiers, from Common (1)
// to Mythic (7). Rolling a rarity, its bonus size and its quantity (for
// "more missiles / mines" cards). Like world.ts, nothing is drawn here.

import { randRange } from '../engine/math';
import { CONFIG, RARITIES, RARITY_ORDER, type Rarity } from './config';

export { RARITY_ORDER };
export type { Rarity };

/** The highest rarity (merging three of these gives a "+N" version instead of a higher tier). */
export const MAX_RARITY: Rarity = RARITY_ORDER[RARITY_ORDER.length - 1];

/** A rarity's tier: 1 (Common) to 7 (Mythic). */
export const rarityTier = (r: Rarity) => RARITY_ORDER.indexOf(r) + 1;

/** The rarity of a tier (clamped to 1–7). */
export const rarityAt = (tier: number): Rarity => RARITY_ORDER[Math.max(1, Math.min(RARITY_ORDER.length, Math.round(tier))) - 1];

/** The next rarity up (Mythic stays Mythic). */
export const nextRarity = (r: Rarity) => rarityAt(rarityTier(r) + 1);

/** Name and colour (and `holo` for Mythic). */
export const rarityInfo = (r: Rarity) => RARITIES[r];

export type RarityWeights = Record<Rarity, number>;

/** How often each rarity comes up: normal cards and drops, or an elite's better drops. */
export function rarityWeights(source: 'normal' | 'elite' = 'normal'): RarityWeights {
  const table = source === 'elite' ? CONFIG.elite : CONFIG.rarity;
  return Object.fromEntries(RARITY_ORDER.map((r) => [r, table[`${r}Weight`]])) as RarityWeights;
}

/** Roll a rarity with the given odds. */
export function rollRarity(weights: RarityWeights = rarityWeights()): Rarity {
  let roll = Math.random() * RARITY_ORDER.reduce((sum, r) => sum + weights[r], 0);
  return RARITY_ORDER.find((r) => (roll -= weights[r]) < 0) ?? 'common';
}

/** A rarity's card bonus (0.1 = +10%). */
export const rarityBonus = (r: Rarity) => CONFIG.rarity[`${r}Bonus`];

/** How much bigger a rarity's bonuses are than Common's (items use this on their own Common bonus). */
export const rarityScale = (r: Rarity) => rarityBonus(r) / CONFIG.rarity.commonBonus;

/** How many a quantity card of this rarity adds (whole numbers). */
export const rarityCount = (r: Rarity) => CONFIG.rarity[`${r}Count`];

/** A random factor within ± CONFIG.rarity.spread (1 = exactly the listed bonus). */
export const rollSpread = () => 1 + randRange(-CONFIG.rarity.spread, CONFIG.rarity.spread);

/** Round a bonus to whole percent (0.1234 → 0.12). */
export const roundBonus = (x: number) => Math.round(x * 100) / 100;
