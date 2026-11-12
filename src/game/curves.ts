// Progression curves: how big enemy fleets get, and how much XP each level needs.
// Kept in their own file so the tuning page can show a preview table of them.

import { CONFIG } from './config';

/** Value of the enemy fleet that comes in this wave (in tier-1 ships), rounded. */
export function enemyFleetValue(wave: number) {
  const c = CONFIG;
  return Math.max(1, Math.round(c.enemyFleetValueStart + c.enemyFleetValuePerWave * wave ** c.enemyFleetValueCurve));
}

/** XP needed to go from `level` to the next one. */
export function xpToNextLevel(level: number) {
  const L = CONFIG.levels;
  return Math.round(L.firstLevelXp * L.growth ** (level - 1));
}
