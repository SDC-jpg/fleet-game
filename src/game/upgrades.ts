// Skill upgrades: what a skill's rank-up cards can improve, how much one card
// adds, and how upgrades add up. Used by level-up cards, by skills, and by
// Mythic items that carry a card's bonus. Like world.ts, nothing is drawn here.

import { CONFIG, SKILLS, type SkillId, type SkillStat } from './config';
import { rarityBonus, rarityCount, rollSpread, roundBonus, type Rarity } from './rarity';

export type SkillMods = Record<SkillStat, number>;

/** Upgrades before any card: no change (count = extra missiles or mines, 0 = none). */
export const newMods = (): SkillMods => ({ power: 1, rate: 1, size: 1, count: 0, reach: 1 });

/**
 * Apply one upgrade: most stats add their bonus (0.15 = +15%); count adds
 * whole missiles or mines; reach multiplies (×1.2 for a range card).
 */
export function addMod(mods: SkillMods | Partial<SkillMods>, stat: SkillStat, amount: number) {
  const neutral = newMods()[stat];
  const now = mods[stat] ?? neutral;
  mods[stat] = stat === 'reach' ? now * (1 + amount) : now + amount;
}

/** The stats a skill's rank-up cards can improve (e.g. Missiles: damage, fire rate, more missiles). */
export const skillStats = (skill: SkillId) => Object.keys(SKILLS[skill].stats) as SkillStat[];

/** What a skill's stat is called on cards ("damage", "missile"...). */
export const statName = (skill: SkillId, stat: SkillStat) => (SKILLS[skill].stats as Partial<Record<SkillStat, string>>)[stat] ?? stat;

/**
 * How much a rank-up card of this rarity improves a stat: quantity cards add
 * whole missiles or mines; range cards are always ×1.2 (CONFIG.freeze.reachPerCard);
 * the rest are a rarity-sized bonus (0.15 = +15%), rolled within the spread
 * unless `roll` is false (the card index shows the middle value).
 */
export function rankAmount(stat: SkillStat, rarity: Rarity, roll = true) {
  if (stat === 'count') return rarityCount(rarity);
  if (stat === 'reach') return roundBonus(CONFIG.freeze.reachPerCard - 1);
  return roundBonus(rarityBonus(rarity) * (roll ? rollSpread() : 1));
}

/** What an upgrade does, in words: "+15% damage", "+2 missiles", "+20% range". */
export function upgradeText(skill: SkillId, stat: SkillStat, amount: number) {
  const name = statName(skill, stat);
  if (stat === 'count') return `+${amount} ${name}${amount === 1 ? '' : 's'}`;
  return `+${Math.round(amount * 100)}% ${name}`;
}
