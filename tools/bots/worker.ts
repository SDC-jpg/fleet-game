// One bot worker: plays runs of the real game (no browser, no drawing) and prints one JSON line
// per finished run. Started by tools/bots/run.mjs; its argument is a job:
//   { "kind": "single", "group": "laser", "forced": "laser", "cap": 1500 }
//   { "kind": "career", "group": "career-3", "until": <epoch ms>, "cap": 1500 }
// A career plays run after run in one "browser" (its equipment, Merge Module and loot count are
// kept between runs, like a real player's), until `until`.

// Saved progress lives in a pretend browser storage, one per worker.
const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => void (store[k] = String(v)),
  removeItem: (k: string) => void delete store[k],
  clear: () => Object.keys(store).forEach((k) => delete store[k]),
  key: (i: number) => Object.keys(store)[i] ?? null,
  get length() {
    return Object.keys(store).length;
  },
};

const { CONFIG } = await import('../../src/game/config');
const W = await import('../../src/game/world');
const { applyCard, pickCard } = await import('../../src/game/progress');
const { gearscore, equip, unequip, mergeItems, pickMergeSet, slotOf } = await import('../../src/game/equipment');
const { loadEquipment, saveEquipment } = await import('../../src/game/save');
const { Pilot } = await import('./pilot');
import type { SkillId } from '../../src/game/config';
import type { GameState } from '../../src/game/world';

type Job = { kind: 'single' | 'career'; group: string; forced?: SkillId | null; cap: number; until?: number; runs?: number; noElites?: boolean; leviathanAt?: number };
// "list": print every skill that's switched on, by side (for run.mjs), and stop.
if (process.argv[2] === 'list') {
  const { skillsBySide } = await import('./pilot');
  console.log(JSON.stringify(skillsBySide()));
  process.exit(0);
}
const job: Job = JSON.parse(process.argv[2]);
const DT = 1 / 60;
const RARITIES = ['common', 'uncommon', 'superior', 'rare', 'epic', 'legendary', 'mythic'];

/** How far from you enemies appear: half a 1080p screen's diagonal at this zoom, plus the margin (as Game.ts). */
const spawnDistance = (s: GameState) => Math.hypot(1920, 1080) / (2 * s.zoom * W.detailFactor(s)) + CONFIG.spawnMargin;

/** Between runs, the average player sorts their equipment: merges spare items (if they have the Merge Module) and wears the best. */
function tidyEquipment(state: GameState) {
  if (state.mergeLevel >= 1) {
    for (let guard = 0; guard < 200; guard++) {
      const free = state.items.filter((it) => slotOf(state, it.id) < 0);
      const set = pickMergeSet(free, 3, state.mergeAllow, undefined, 'low');
      if (!set || !mergeItems(state, set.map((it) => it.id))) break;
    }
  }
  const worth = (it: (typeof state.items)[number]) => RARITIES.indexOf(it.rarity) * 10 + (it.plus ?? 0) * 3 + it.amount;
  for (const id of state.slots) if (id !== null) unequip(state, id);
  const best = [...state.items].sort((a, b) => worth(b) - worth(a));
  for (const it of best) if (!equip(state, it.id)) break;
  saveEquipment(state);
}

function playRun(runIndex: number) {
  const state = W.createGame(() => 0.5);
  loadEquipment(state);
  if (job.noElites) state.elitesEnabled = false;
  const pilot = new Pilot(job.forced ?? null);
  if (job.forced) applyCard(state, { kind: 'skill', skill: job.forced }, true);
  const gearStart = gearscore(state);
  const picks: string[] = [];
  const waves: { wave: number; time: number; value: number; level: number; tier: number }[] = [];
  let lastWave = 0;
  const started = Date.now();
  // A Leviathan fight (forced at job.leviathanAt, or by its own spawn rule): when it came, how it ended.
  let boss: { wave: number; start: number; end: number | null; killed: boolean; value: number; tier: number; hpLeft: number } | null = null;
  while (!state.gameOver && state.time < job.cap) {
    if (state.cards) {
      const i = pilot.pickCard(state, state.cards);
      const c = state.cards[i];
      picks.push(c.kind === 'skill' ? `skill:${c.skill}` : c.kind === 'rank' ? `rank:${c.skill}` : c.kind);
      pickCard(state, i, true);
      continue;
    }
    if (state.finalBlow && !state.finalBlow.ready) state.finalBlow.ready = true;
    if (state.unlocked) state.unlocked = null;
    if (job.leviathanAt && state.wave === job.leviathanAt - 1 && !boss && !state.bossIntro) state.nextLeviathan = true;
    W.updateGame(state, pilot.controls(state, DT), DT, spawnDistance(state));
    state.sounds.length = 0;
    const lev = state.ships.find((x) => x.leviathan);
    if (lev && !boss) boss = { wave: state.wave, start: state.time, end: null, killed: false, value: W.fleetValue(state.playerFleet), tier: state.maxTier, hpLeft: 1 };
    if (boss && boss.end === null) {
      if (lev) boss.hpLeft = Math.max(0, lev.hp / lev.stats.maxHp);
      if (!lev || lev.dead) {
        boss.end = state.time;
        boss.killed = true;
      }
    }
    // With a forced fight, the run ends once it's decided.
    if (job.leviathanAt && boss?.end != null && state.time > boss.end + 2) break;
    if (state.wave !== lastWave) {
      lastWave = state.wave;
      waves.push({ wave: state.wave, time: Math.round(state.time), value: W.fleetValue(state.playerFleet), level: state.level, tier: state.maxTier });
    }
    if (state.equipmentChanged) {
      state.equipmentChanged = false;
      saveEquipment(state);
    }
  }
  const s = state.stats;
  const record = {
    group: job.group,
    kind: job.kind,
    forced: job.forced ?? null,
    run: runIndex,
    wave: state.wave,
    time: Math.round(state.time),
    capped: !state.gameOver,
    bestValue: state.maxFleetSize,
    maxTier: state.maxTier,
    level: state.level,
    gearStart,
    gearEnd: gearscore(state),
    looted: state.looted,
    mergeLevel: state.mergeLevel,
    items: state.items.length,
    skills: state.skills.map((k) => ({ id: k.id, rank: k.rank })),
    picks,
    kills: s.kills,
    killValue: s.killValue,
    losses: s.losses,
    lossValue: s.lossValue,
    killsBySource: s.killsBySource,
    damageBySource: s.damageBySource,
    killsByClass: s.killsByClass,
    skillUses: s.skillUses,
    modes: pilot.modes,
    waves,
    realSeconds: Math.round((Date.now() - started) / 100) / 10,
    boss: boss && { ...boss, end: boss.end ?? state.time, lost: !boss.killed },
  };
  if (job.kind === 'career') tidyEquipment(state);
  return record;
}

if (job.kind === 'single') console.log(JSON.stringify(playRun(1)));
else for (let i = 1; i <= (job.runs ?? Infinity) && Date.now() < (job.until ?? 0); i++) console.log(JSON.stringify(playRun(i)));
