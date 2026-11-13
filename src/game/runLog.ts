// The run log: one line per finished run, kept in this browser across
// versions (each line says which version it was played on). Shown on the
// "Fleet destroyed" screen.

import { loadSetting, saveSetting } from '../engine/settings';
import { BUILD } from './save';
import type { GameState } from './world';

export interface RunRecord {
  /** The version (build number, or "dev") the run was played on. */
  build: string;
  /** When the run ended (ISO date and time). */
  ended: string;
  /** Best fleet value. */
  best: number;
  /** Seconds survived. */
  time: number;
  /** Wave reached when the run ended. */
  waves: number;
  kills: number;
  losses: number;
  killValue: number;
  lossValue: number;
}

const KEY = 'fleet-game.runs';
/** Oldest runs are dropped past this many, so browser storage never fills up. */
const MAX_RUNS = 1000;

export function loadRuns(): RunRecord[] {
  try {
    const list = JSON.parse(loadSetting(KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Add the run that just ended to the log, and return the whole log. */
export function recordRun(state: GameState): RunRecord[] {
  const s = state.stats;
  const run: RunRecord = {
    build: BUILD,
    ended: new Date().toISOString(),
    best: state.maxFleetSize,
    time: Math.floor(state.survived),
    waves: state.wave,
    kills: s.kills,
    losses: s.losses,
    killValue: s.killValue,
    lossValue: s.lossValue,
  };
  const runs = [...loadRuns(), run].slice(-MAX_RUNS);
  saveSetting(KEY, JSON.stringify(runs));
  return runs;
}
