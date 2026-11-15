// The run log: one line per finished run, kept in this browser across
// versions (each line says which version it was played on). Shown on the
// "Fleet destroyed" screen. Each player has a two-letter code (made up once per
// browser, maybe replaced by a nickname later), so runs from several players
// can be listed together.

import { loadSetting, saveSetting } from '../engine/settings';
import { gearscore } from './equipment';
import { BUILD } from './save';
import type { GameState } from './world';

export interface RunRecord {
  /** Who played it: a two-letter player code. Missing on runs logged before codes existed (those were played in this browser). */
  player?: string;
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
  /** Gearscore of the equipped items when the run ended. Missing on older runs. */
  gearscore?: number;
}

const KEY = 'fleet-game.runs';
const PLAYER_KEY = 'fleet-game.player';

/** This browser's player code: two random letters, made up the first time and then kept. */
let myId: string | null = null;
export function playerId(): string {
  if (myId) return myId;
  const saved = loadSetting(PLAYER_KEY);
  if (saved && /^[A-Z]{2}$/.test(saved)) return (myId = saved);
  const letter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  myId = letter() + letter();
  saveSetting(PLAYER_KEY, myId);
  return myId;
}
/** Oldest runs are dropped past this many, so browser storage never fills up. */
const MAX_RUNS = 1000;

export function loadRuns(): RunRecord[] {
  try {
    const list = JSON.parse(loadSetting(KEY) ?? '[]');
    if (!Array.isArray(list)) return [];
    // Runs from before player codes were played in this browser: they're this player's.
    const me = playerId();
    return list.map((r: RunRecord) => (r.player ? r : { ...r, player: me }));
  } catch {
    return [];
  }
}

/** Add the run that just ended to the log, and return the whole log. */
export function recordRun(state: GameState): RunRecord[] {
  const s = state.stats;
  const run: RunRecord = {
    player: playerId(),
    build: BUILD,
    ended: new Date().toISOString(),
    best: state.maxFleetSize,
    time: Math.floor(state.survived),
    waves: state.wave,
    kills: s.kills,
    losses: s.losses,
    killValue: s.killValue,
    lossValue: s.lossValue,
    gearscore: gearscore(state),
  };
  const runs = [...loadRuns(), run].slice(-MAX_RUNS);
  saveSetting(KEY, JSON.stringify(runs));
  return runs;
}
