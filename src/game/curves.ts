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

/** Gap before the wave after `wave`, before its random swing (each gap waveIntervalShrink times the last). */
export function waveGapBase(wave: number) {
  return CONFIG.waveInterval * CONFIG.waveIntervalShrink ** (wave - 1);
}

/** Average gap after `wave`, counting the random swing and the waveIntervalMin floor. */
export function averageWaveGap(wave: number) {
  const b = waveGapBase(wave);
  const m = CONFIG.waveIntervalMin;
  const lo = b * (1 - CONFIG.waveIntervalRandom);
  const hi = b * (1 + CONFIG.waveIntervalRandom);
  if (lo >= m) return b;
  if (hi <= m) return m;
  // The swing is even between lo and hi; anything below m is raised to m.
  return (m * (m - lo) + (hi * hi - m * m) / 2) / (hi - lo);
}

/** Average seconds of play (pauses not counted) until this wave starts. */
export function waveStartTime(wave: number) {
  let t = CONFIG.firstWaveDelay;
  for (let k = 1; k < wave; k++) t += averageWaveGap(k);
  return t;
}
