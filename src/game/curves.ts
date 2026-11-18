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

/**
 * How many ships of each tier a fleet of this value has: [tier 1, tier 2, ...].
 * Below the merge threshold it's all tier 1. Above it, it's like writing the
 * value in base shipsPerMerge (e.g. 300 = 2 × 144 + 1 × 12).
 */
export function tierCounts(value: number): number[] {
  const per = CONFIG.tiers.shipsPerMerge;
  if (value < CONFIG.tiers.mergeStartsAt) return [value];
  const counts: number[] = [];
  for (let v = value; v > 0; v = Math.floor(v / per)) counts.push(v % per);
  return counts;
}

/** Does this wave bring an enemy fleet (instead of lone fighters)? */
export function isFleetWave(wave: number) {
  const first = CONFIG.enemyFleetsFromWave;
  return wave >= first && (wave - first) % CONFIG.enemyFleetEveryNthWave === 0;
}

/** Lone fighters a wave without an enemy fleet brings (before the limit on enemies alive at once). */
export function loneEnemyCount(wave: number) {
  const base = 1 + Math.floor(wave * CONFIG.loneEnemiesPerWave);
  const early = wave <= CONFIG.earlyWavesUntil ? 1 + CONFIG.earlyWaveExtraEnemies : 1;
  // Late waves bring more (and allow more).
  const late = lateWaveMultiplier(wave);
  return Math.min(Math.round(base * early * late), Math.round(CONFIG.maxLoneEnemiesPerWave * late));
}

/** XP an enemy of this tier is worth (CONFIG.levels.xpByTier; past its end, growing by its last step). */
export function xpForTier(tier: number) {
  const table = CONFIG.levels.xpByTier;
  if (tier <= table.length) return table[Math.max(0, tier - 1)];
  const last = table[table.length - 1];
  const step = table.length > 1 ? last / table[table.length - 2] : 1;
  return last * step ** (tier - table.length);
}

/** XP for destroying an enemy of `tier` while flying a ship of `yourTier`: less for smaller enemies (xpLowerTierFactor), at least 1. */
export function killXp(tier: number, yourTier: number) {
  const below = Math.max(0, yourTier - tier);
  return Math.max(1, Math.round(xpForTier(tier) * CONFIG.levels.xpLowerTierFactor ** below));
}

/** XP an elite of this tier gives: more than a normal ship, but never more than elite.xpMaxLevels levels' worth. */
export function eliteXp(tier: number, yourTier: number, level: number) {
  return Math.min(killXp(tier, yourTier) * CONFIG.elite.xpMultiplier, CONFIG.elite.xpMaxLevels * xpToNextLevel(level));
}

/**
 * Estimate for the tuning page: the level you'd have when each wave starts if you
 * destroyed every enemy of the waves before it (lone fighters, enemy fleets and
 * elites; swarms left out since they depend on your fleet, and every kill counted
 * at full XP). Real players miss some, so it's an upper guide. Index = wave.
 */
export function expectedLevels(maxWave: number): number[] {
  const levels = [1, 1];
  let level = 1;
  let xp = 0;
  let eliteDue = false;
  const gain = (amount: number) => {
    xp += amount;
    while (xp >= xpToNextLevel(level)) xp -= xpToNextLevel(level++);
  };
  for (let wave = 1; wave < maxWave; wave++) {
    const E = CONFIG.elite;
    const fleet = isFleetWave(wave);
    const counts = tierCounts(Math.max(1, Math.round(waveFleetValue(wave))));
    const eliteSlot: boolean = eliteDue || (E.enabled && wave >= E.firstWave && wave % E.everyNthWave === 0);
    eliteDue = eliteSlot && fleet;
    if (eliteSlot && !fleet) gain(eliteXp(counts.length + E.extraTiers, 1, level));
    if (fleet) counts.forEach((n, i) => gain(n * xpForTier(i + 1)));
    else gain(loneEnemyCount(wave));
    levels.push(level);
  }
  return levels;
}
