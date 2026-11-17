// Resuming an interrupted run (browser crash, closed tab, accidental reload).
//
// Not an exact copy of the battle: a small snapshot of the run's progress
// (wave, fleet value, level and XP, skills, bonus cards, stats) is kept in
// the browser while you play: every few seconds, at each new wave, and when
// the page is hidden or closed. Resuming clears the field, rebuilds your fleet
// from its value (the same ships merging would give) and starts the saved
// wave again. The snapshot is deleted when the run ends or you choose a new
// run. Equipment is saved separately (save.ts) and isn't part of this.

import { CONFIG, SKILLS, skillEnabled, type SkillId } from './config';
import { updateBonuses } from './equipment';
import { BUILD } from './save';
import { emptyStats, fleetValue, rebuildPlayerFleet, zoomFor, type GameState, type HistoryPoint, type OwnedSkill, type RunStats } from './world';

const KEY = 'fleet-game.run';

export interface RunSnapshot {
  format: 1;
  /** The build it was saved by (shown; any build may resume it). */
  build: string;
  /** When it was saved (Date.now()). */
  savedAt: number;
  wave: number;
  /** Seconds survived when the saved wave started (the run resumes from there). */
  waveStartTime: number;
  fleetValue: number;
  level: number;
  xp: number;
  pendingLevels: number;
  skills: OwnedSkill[];
  /** The selected weapon skill (missing in older snapshots). */
  activeWeapon?: number;
  cardBonus: { damage: number; fireRate: number };
  stats: RunStats;
  history: HistoryPoint[];
  maxFleetSize: number;
  maxTier: number;
  elitesSpawned: number;
  skilledElites?: number;
  /** Reinforcements already sent this run (CONFIG.reinforcements). */
  reinforcementsUsed?: number;
  eliteDue: boolean;
}

/** Whether a run is worth saving: it has started (wave 1 or later) and isn't over. */
export const canSaveRun = (state: GameState) => state.wave >= 1 && !state.gameOver && fleetValue(state.playerFleet) > 0;

/** Save the run's progress (see the top of this file). */
export function saveRun(state: GameState) {
  if (!canSaveRun(state)) return;
  const start = state.history.find((p) => p.wave === state.wave);
  const snap: RunSnapshot = {
    format: 1,
    build: BUILD,
    savedAt: Date.now(),
    wave: state.wave,
    waveStartTime: start?.time ?? state.survived,
    fleetValue: fleetValue(state.playerFleet),
    level: state.level,
    xp: state.xp,
    // Cards on screen count as a level still to pick (they're drawn again).
    pendingLevels: state.pendingLevels + (state.cards ? 1 : 0),
    skills: state.skills.map((sk) => ({ ...sk, mods: { ...sk.mods } })),
    activeWeapon: state.activeWeapon,
    cardBonus: { ...state.cardBonus },
    stats: emptyStats(state.stats),
    history: state.history.map((p) => ({ ...p })),
    maxFleetSize: state.maxFleetSize,
    maxTier: state.maxTier,
    elitesSpawned: state.elitesSpawned,
    skilledElites: state.skilledElites,
    reinforcementsUsed: state.reinforcementsUsed,
    eliteDue: state.eliteDue,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    // Storage full or blocked: nothing to resume later, the game goes on.
  }
}

/** The saved run, if there is one that can be resumed. */
export function loadRun(): RunSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as RunSnapshot;
    if (snap?.format !== 1 || !(snap.wave >= 1) || !(snap.fleetValue >= 1)) return null;
    return snap;
  } catch {
    return null;
  }
}

/** Forget the saved run (it ended, or a new one was chosen). */
export function clearRun() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}

/** Turn a fresh game into the saved run, at the start of its saved wave with an empty field. */
export function restoreRun(state: GameState, snap: RunSnapshot) {
  state.level = snap.level;
  state.xp = snap.xp;
  state.pendingLevels = snap.pendingLevels;
  // Skills that no longer exist or were switched off are left out; all start ready.
  state.skills = snap.skills
    .filter((sk) => sk.id in SKILLS && skillEnabled(sk.id as SkillId))
    .map((sk) => ({ ...sk, timer: 0 }));
  state.activeWeapon = snap.activeWeapon ?? 0;
  state.cardBonus = { ...snap.cardBonus };
  state.stats = emptyStats(snap.stats);
  state.maxFleetSize = snap.maxFleetSize;
  state.maxTier = snap.maxTier;
  state.elitesSpawned = snap.elitesSpawned;
  state.skilledElites = snap.skilledElites ?? 0;
  state.reinforcementsUsed = snap.reinforcementsUsed ?? 0;
  state.eliteDue = snap.eliteDue;
  // The saved wave comes again shortly (its start is added to the graph again then).
  state.wave = snap.wave - 1;
  state.waveTimer = CONFIG.firstWaveDelay;
  state.survived = snap.waveStartTime;
  state.history = snap.history.filter((p) => p.wave < snap.wave);
  // Bonuses first, so the new ships get the fleet's health bonus.
  updateBonuses(state);
  rebuildPlayerFleet(state, snap.fleetValue);
  updateBonuses(state);
  state.zoom = zoomFor(state);
}
