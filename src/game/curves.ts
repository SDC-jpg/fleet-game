// Progression curves: how big enemy fleets get, and how much XP each level needs.
// Kept in their own file so the tuning page can show a preview table of them.

import { CONFIG } from './config';

/** Value of the enemy fleet that comes in this wave (in tier-1 ships), rounded. */
export function enemyFleetValue(wave: number) {
  const c = CONFIG;
  return Math.max(1, Math.round(c.enemyFleetValueStart + c.enemyFleetValuePerWave * wave ** c.enemyFleetValueCurve));
}

/** Late waves bring more lone enemies (and allow more): this many times as many. */
export function lateWaveMultiplier(wave: number) {
  return 1 + CONFIG.lateWaveGrowth * Math.max(0, wave - CONFIG.lateWavesFrom);
}

/** Late waves: enemy fleets are this many times stronger, growing by lateFleetGrowth per wave (compounding). */
export function lateFleetMultiplier(wave: number) {
  return (1 + CONFIG.lateFleetGrowth) ** Math.max(0, wave - CONFIG.lateWavesFrom);
}

/** The enemy fleet value a wave actually brings (with the late-wave growth). Elites follow it too. */
export function waveFleetValue(wave: number) {
  return Math.max(1, Math.round(enemyFleetValue(wave) * lateFleetMultiplier(wave)));
}

/** Enemies only: their health multiplier in this wave (enemyHealthPerWave, compounding from wave 1). */
export function enemyHealthMultiplier(wave: number) {
  return CONFIG.enemyHealthPerWave ** Math.max(0, wave - 1);
}

/** XP needed to go from `level` to the next one. */
export function xpToNextLevel(level: number) {
  const L = CONFIG.levels;
  return Math.round(L.firstLevelXp * L.growth ** (level - 1));
}
