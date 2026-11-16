// Lifetime statistics: every finished run's stats added up, kept in this
// browser (for a statistics panel to come). "Clear saved progress" in Settings
// wipes them along with the equipment.

import { loadSetting, saveSetting } from '../engine/settings';
import { emptyStats, type GameState, type RunStats } from './world';

const KEY = 'fleet-game.lifetime';

export interface LifetimeStats extends RunStats {
  /** Finished runs. */
  runs: number;
  /** Seconds played in finished runs. */
  time: number;
  /** Best fleet value and furthest wave in any run. */
  bestValue: number;
  bestWave: number;
}

const emptyLifetime = (from: Partial<LifetimeStats> = {}): LifetimeStats => ({
  runs: 0,
  time: 0,
  bestValue: 0,
  bestWave: 0,
  ...from,
  ...emptyStats(from),
});

export function loadLifetime(): LifetimeStats {
  try {
    return emptyLifetime(JSON.parse(loadSetting(KEY) ?? '{}'));
  } catch {
    return emptyLifetime();
  }
}

/** Adds every number in `from` to `into` (one level of nesting: per tier, per source...). */
function addCounts(into: Record<string, number>, from: Record<string, number>) {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

/** Add the run that just ended to the lifetime totals. */
export function addRunToLifetime(state: GameState) {
  const life = loadLifetime();
  const s = state.stats;
  life.runs++;
  life.time += state.survived;
  life.bestValue = Math.max(life.bestValue, state.maxFleetSize);
  life.bestWave = Math.max(life.bestWave, state.wave);
  life.kills += s.kills;
  life.killValue += s.killValue;
  life.losses += s.losses;
  life.lossValue += s.lossValue;
  life.itemsCollected += s.itemsCollected;
  life.merges += s.merges;
  addCounts(life.killsByTier, s.killsByTier);
  addCounts(life.killsByClass, s.killsByClass);
  addCounts(life.skillUses, s.skillUses);
  for (const [k, v] of Object.entries(s.killsBySource)) {
    const t = (life.killsBySource[k] ??= { kills: 0, value: 0 });
    t.kills += v.kills;
    t.value += v.value;
  }
  saveSetting(KEY, JSON.stringify(life));
}

/** Forget the lifetime totals (Settings → Clear saved progress). */
export function clearLifetime() {
  saveSetting(KEY, JSON.stringify(emptyLifetime()));
}
