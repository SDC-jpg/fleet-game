// The game rules: ships, fleets, tiers and merging, shooting, wrecks, enemy waves.
// No drawing happens here, only updating numbers.

import { approach, clamp, distSq, randRange, turnToward, wrapAngle } from '../engine/math';
import { rarityWeights } from './rarity';
import { CONFIG, SHIP_TYPES, type Rarity, type ShipType, type ShipTypeId, type SkillId, type SkillStat } from './config';
import { enemyHealthMultiplier, lateWaveMultiplier, waveFleetValue, xpToNextLevel } from './curves';
import { interceptMissiles } from './newSkills';
import { drawCards, gainXp } from './progress';
import { defaultMergeAllow, dropItem, maybeDropItem, noBonus, unlockSlots, updateLoot, type FleetBonus, type Item, type Loot, type MergeOrder, type QolDrop } from './equipment';
import { makeEliteSkills, updateEliteSkills, updateSkills } from './skills';
import type { SkillObj } from './moreSkills';

export type Team = 'player' | 'enemy';
export type Thrust = 'idle' | 'move' | 'boost';

/** Ships slower than this count as idle (engine off) for picking their image. */
const MOVING_SPEED = 25;

/** Numbers that depend on a ship's tier (worked out once, see statsFor). */
export interface ShipStats {
  radius: number;
  maxHp: number;
  shots: number;
  bulletDamage: number;
  bulletSpeed: number;
  bulletLife: number;
  bulletRadius: number;
  range: number;
  gunOffset: number;
  /** Seconds between volleys (bigger tiers fire slower but hit harder). */
  fireCooldown: number;
  /** Turn speed in radians per second (bigger tiers turn slower). */
  turnRate: number;
  /** Size compared to tier 1 (1, 1.5, 2.25...). */
  size: number;
}

export interface Ship {
  id: number;
  team: Team;
  type: ShipTypeId;
  /** 1 = basic ship. 16 ships of one tier merge into 1 of the next. */
  tier: number;
  stats: ShipStats;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  fireTimer: number;
  fleet: Fleet;
  dead: boolean;
  /** The merge this ship is part of (it can't shoot or be hit meanwhile). */
  merge: Merge | null;
  /** A merging ship that has already flown into the core (hidden until the merge ends). */
  absorbed: boolean;
  /** What the engine is doing. Picks the image: normal, ".move" or ".boost". */
  thrust: Thrust;
  /** Seconds left frozen (Freeze skill): it can't move, turn or shoot meanwhile. */
  frozen: number;
  /** Seconds left scrambled (Scramble skill): it turns and flies at random, shooting wherever it faces. */
  scrambled: number;
  /** Scrambled: the random direction it's turning toward, and seconds until it picks another. */
  scrambleAngle: number;
  scrambleTimer: number;
  /** Seconds left hijacked (Hijack skill): it fights for the other side meanwhile. */
  hijacked: number;
  /** The team it belonged to before it was hijacked (null = not hijacked). */
  hijackedFrom: Team | null;
  /**
   * While its fleet is cloaked: a still copy of it where it was last seen.
   * Enemies aim at this instead (see findNearestEnemy). null = not hidden.
   */
  ghost: Ship | null;
  /** Damage a Shield (skill) will still absorb, and seconds until it fades. */
  shield: number;
  shieldTime: number;
  /** Set for elite enemies: their skills, and the laser warning countdown. */
  elite: EliteInfo | null;
  /** What dealt the hit that destroyed it (see DamageSource). */
  killedBy?: DamageSource;
  /** Enemies: came as part of a fleet formation (not a lone fighter). */
  inFleet?: boolean;
  /** Personal randomness so ships in a formation don't move in perfect sync. */
  quirk: { phaseX: number; phaseY: number; speedX: number; speedY: number; delay: number };
}

/** What makes a ship an elite enemy. */
export interface EliteInfo {
  skills: OwnedSkill[];
  /** Seconds left of the laser warning line (0 = not charging). The laser fires when it reaches 0. */
  laserCharge: number;
  /** Its health compared to a normal ship of its tier (its Shield skill matches it). */
  healthScale: number;
}

/** 15 ships flying into a 16th (the core), which then becomes one tier bigger. */
export interface Merge {
  core: Ship;
  parts: Ship[];
  time: number;
}

/** A group of ships that fly together. The leader decides where the fleet goes. */
export interface Fleet {
  team: Team;
  leader: Ship | null;
  members: Ship[];
  /** Recent leader positions, oldest first, so followers can react with a delay. */
  trail: LeaderSample[];
  /** Which ship the trail belongs to (reset when the leader changes). */
  trailLeaderId: number;
  /** Seconds left of a dash (Space), counting down to 0. */
  dashTime: number;
  /** Speed multiplier at the start of the current dash (fades to 1). */
  dashPower: number;
  /** Direction of the current dash. */
  dashX: number;
  dashY: number;
  /** Force Dash: enemies already hit during the current dash. */
  dashHits?: Set<Ship>;
  /** Set for a chevron of a swarm wave: it flies its own curving path (see updateEnemyLeader). */
  swarm: SwarmInfo | null;
  /** Seconds left cloaked (Cloaking skill): enemies can't see its ships, only where they were. */
  cloak: number;
}

/** A swarm chevron's path and shape. */
export interface SwarmInfo {
  /** Which way the whole swarm curves: 1 or -1 (the same for every chevron of a wave). */
  turn: number;
  /** How far away it started (the curve tightens as it gets closer). */
  from: number;
  /** Each follower's spot behind the leader (x forward, y sideways) and its row (0 = front). */
  slots: Map<number, { x: number; y: number; row: number }>;
}

/** Where the leader was, and what it was doing, at one moment. */
interface LeaderSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  boosting: boolean;
}

const newFleet = (team: Team): Fleet => ({
  team,
  leader: null,
  members: [],
  trail: [],
  trailLeaderId: 0,
  dashTime: 0,
  dashPower: 1,
  dashX: 0,
  dashY: 0,
  swarm: null,
  cloak: 0,
});

export interface Bullet {
  team: Team;
  /** Base sprite name; the tier picks the size (see tierSprite in render.ts). */
  sprite: string;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  radius: number;
  /** Homing missiles: how fast they turn toward `target` (0 = fly straight). */
  homing: number;
  target: Ship | null;
  /** Missiles: which way it points (it turns before speeding off, so this can differ from its movement). */
  facing?: number;
  /** Missiles: which way the ship that launched it faced at launch (with no target, a missile heads that way). */
  launchAngle?: number;
  /** Missiles: its speed when it started speeding off. */
  boostFrom?: number;
  /** Missiles: seconds after launch when it fires up (lights its thruster), and whether it has. */
  igniteAt?: number;
  lit?: boolean;
  /** Missiles: out of fuel. It tumbles, harmless, until its life runs out (CONFIG.missiles.tumbleTime). */
  spent?: boolean;
  /** A spent missile's spin (radians per second). */
  spin?: number;
  /** What fired it, for the kills-by-weapon stats (missing = a ship's gun). */
  source?: DamageSource;
  /** Point Defense Cannon round: it only hits enemy missiles (shooting them down), never ships. */
  interceptor?: boolean;
}

export interface Wreck {
  type: ShipTypeId;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  life: number;
}

/**
 * Something that should make a sound. The rules only announce it; Game.ts
 * plays it (louder near the middle of the screen, panned left/right).
 */
export interface SoundEvent {
  /** Base sound name; the tier picks a bigger version (see Game.ts). */
  name: string;
  tier: number;
  x: number;
  y: number;
  /** Extra volume factor, 0–1. */
  volume: number;
  /** Not tied to a place (alerts, game over): always full volume, centred. */
  global: boolean;
}

/** A visual effect that plays once (explosion, hit spark...). */
/** A spinning piece of a destroyed flagship (drawing only; see CONFIG.death). */
export interface Debris {
  team: Team;
  /** Which piece of the vfx.debris sheet (each frame is a different piece). */
  piece: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  age: number;
  life: number;
  scale: number;
}

export interface Effect {
  sprite: string;
  /** Picks a bigger version of the effect for bigger ships, if the art exists. */
  tier: number;
  x: number;
  y: number;
  angle: number;
  age: number;
  /** Drawn this many times its normal size (e.g. a Repulse ring with a reach upgrade). */
  scale: number;
  /**
   * For an effect that belongs to a point on an object (a missile's impact burst):
   * the object's sprite and tier, which way it faced, and the point's name (see art.json).
   */
  at?: { sprite: string; tier: number; angle: number; point: string };
}

/** Ships destroyed on each side this run (merged ships don't count as losses). */
export interface RunStats {
  kills: number;
  /** What the destroyed enemies were worth, in tier-1 ships. */
  killValue: number;
  losses: number;
  lossValue: number;
  /** Items picked up. */
  itemsCollected: number;
  /** Merges done in the Merge Module (each uses 3 items). */
  merges: number;
  /** Enemies destroyed per tier ("1", "2"...). */
  killsByTier: Record<string, number>;
  /** Enemies destroyed per enemy class: "elite", "swarm", "fleet" (in an enemy fleet formation) or "lone". */
  killsByClass: Record<string, number>;
  /** What destroyed them: "gun" (your ships' guns), "merge" (merge bursts), "hijack" (ships you took over), or a skill id. */
  killsBySource: Record<string, { kills: number; value: number }>;
  /** Times each of your skills was used. */
  skillUses: Record<string, number>;
}

/** What dealt a hit (for the kills-by-weapon stats): "gun", "merge", "hijack", or a skill id. */
export type DamageSource = string;

/** Empty run stats (also fills in what older saved stats don't have). */
export const emptyStats = (from: Partial<RunStats> = {}): RunStats => ({
  kills: 0,
  killValue: 0,
  losses: 0,
  lossValue: 0,
  itemsCollected: 0,
  merges: 0,
  ...from,
  killsByTier: { ...from.killsByTier },
  killsByClass: { ...from.killsByClass },
  killsBySource: Object.fromEntries(Object.entries(from.killsBySource ?? {}).map(([k, v]) => [k, { ...v }])),
  skillUses: { ...from.skillUses },
});

/** Fleet value at one moment (one point per wave, for the end-of-run graph). */
export interface HistoryPoint {
  time: number;
  wave: number;
  value: number;
}

/** A skill you've picked, with its rank (1–5) and seconds until it's ready again. */
export interface OwnedSkill {
  id: SkillId;
  rank: number;
  timer: number;
  /** Crescent Strike: which way the last one curved (they alternate). */
  flip?: number;
  /** Upgrades from rank-up cards, as multipliers (1 = none, 1.15 = +15%). */
  mods: Record<SkillStat, number>;
}

/** A level-up card. */
export type Card =
  | { kind: 'skill'; skill: SkillId }
  /** Rank-up for a skill you have: `stat` gets +`amount` (0.15 = +15%). */
  | { kind: 'rank'; skill: SkillId; stat: SkillStat; rarity: Rarity; amount: number }
  | { kind: 'damage' }
  | { kind: 'fireRate' }
  | { kind: 'repair' };

/** A laser beam, drawn for a moment after it fires (it hits instantly). */
export interface Beam {
  team: Team;
  tier: number;
  x: number;
  y: number;
  angle: number;
  length: number;
  /** Width compared to normal (beam size upgrades). */
  width: number;
  age: number;
}

/** A mine waiting for an enemy to come near. */
export interface Mine {
  team: Team;
  tier: number;
  x: number;
  y: number;
  /** Seconds since it was dropped (it arms after CONFIG.mines.armTime). */
  age: number;
  damage: number;
  triggerRadius: number;
  blastRadius: number;
  /** Size compared to normal (blast size upgrades), for drawing the blast. */
  scale: number;
}

export interface GameState {
  /** Clock for animations. Keeps running after game over. */
  time: number;
  /** How long you've survived (stops at game over). */
  survived: number;
  ships: Ship[];
  bullets: Bullet[];
  wrecks: Wreck[];
  effects: Effect[];
  /** Spinning pieces of a destroyed flagship. */
  debris: Debris[];
  /** Screen shake: seconds left, and how strong it started (screen pixels). */
  shake: { time: number; strength: number };
  /** Game time when the run ended (the end-of-run screen waits CONFIG.death.screenDelay after it). */
  gameOverAt: number;
  /**
   * The blow that destroyed your last ship: it hangs on in slow motion (Game.ts slows time and zooms in)
   * until `ready`, then explodes as usual.
   */
  finalBlow: { ship: Ship; ready: boolean } | null;
  merges: Merge[];
  /** Sounds announced this step. Game.ts plays and clears them. */
  sounds: SoundEvent[];
  playerFleet: Fleet;
  enemyFleets: Fleet[];
  wave: number;
  waveTimer: number;
  /** Seconds until you can dash again (0 = ready). */
  dashCooldown: number;
  /** Your level, and XP gathered toward the next one. */
  level: number;
  xp: number;
  /** Level-ups waiting for a card to be picked. */
  pendingLevels: number;
  /** Seconds since a level-up started waiting for its cards (they appear after CONFIG.levels.cardDelay). */
  cardDelay: number;
  /** Game time before which level-up cards wait (the explosion of the kill that levelled you up is still playing). */
  cardWaitUntil: number;
  /** The level-up cards on offer (the game is paused while there are some). */
  cards: Card[] | null;
  /** Skills you've picked, in the order you got them. */
  skills: OwnedSkill[];
  /** Which of your weapon skills (left click) is selected, counting only weapons in the order you got them. Only that one fires (1, 2, 3 or the mouse wheel switch). */
  activeWeapon: number;
  /** Extra damage and fire rate from bonus cards (0.1 = +10%). */
  cardBonus: { damage: number; fireRate: number };
  /** Skill upgrades from equipped Mythic items' card bonuses (added to your skills' own; see modsOf). */
  skillBonus: Partial<Record<SkillId, Partial<Record<SkillStat, number>>>>;
  /** All bonuses for your whole fleet, from cards and equipment (1 = none, 1.1 = +10%). See updateBonuses. */
  bonus: FleetBonus;
  /** Every item you've found (your inventory, equipped or not). */
  items: Item[];
  /**
   * Equipment slots, in order: 3 per tier (slots 0–2 for tier 1, 3–5 for tier 2...),
   * up to CONFIG.items.maxSlotTier. Each holds an item id or null (empty).
   */
  slots: (number | null)[];
  /** Set when items, slots or unlocks change, so Game.ts saves them (see save.ts). */
  equipmentChanged: boolean;
  /** Highest tier whose slots are unlocked (reached with your biggest ship, up to maxSlotTier). */
  unlockedTier: number;
  /** Items floating in space, waiting to be picked up. */
  loot: Loot[];
  /** The last item picked up, and when (for a short message on screen). */
  /** Items picked up in every run so far (saved): enough of them brings the Merge Module. */
  looted: number;
  /** Your Merge Module (saved): 0 = none, 1 = Merge Module, 2–4 = Merge Mk. II–IV (Load, QuickMerge, AutoMerge). */
  mergeLevel: number;
  /** Rarities QuickMerge and AutoMerge may use (saved; set in the module's settings, Mk. III and up). */
  mergeAllow: Rarity[];
  /** Whether QuickMerge and AutoMerge use the least rare items first ('low', default) or the rarest ('high') (saved; Mk. III and up). */
  mergeOrder: MergeOrder;
  /** AutoMerge is switched on (saved; Mk. IV). */
  autoMerge: boolean;
  /** A quality-of-life drop just picked up (the game opens its screen, then clears this). */
  unlocked: QolDrop | null;
  found: { item: Item; time: number } | null;
  beams: Beam[];
  mines: Mine[];
  /** Things the newer skills left in the world for a moment (crescents, ion balls, lances...). */
  skillObjs: SkillObj[];
  /** Whether elites come this run (CONFIG.elite.enabled, or the test key O). */
  elitesEnabled: boolean;
  /** Elites spawned so far this run (each new one gets more skills). */
  elitesSpawned: number;
  /** An elite is waiting to come (its wave brought an enemy fleet, so it comes next wave). */
  eliteDue: boolean;
  /** When the last elite arrived (for the "Elite incoming" message). */
  eliteAlertTime: number;
  /** When the last swarm wave arrived (for the "Swarm incoming" message). */
  swarmAlertTime: number;
  /** Skills of the elites announced by the current "Elite incoming" warning (Tech Scanner shows them). */
  eliteAlertSkills: SkillId[][];
  /** Point Defense Cannons (your skill): ammo (0–1), whether they ran dry and wait to reload, the missile they're locked on, each cannon's aim. */
  pdc: { ammo: number; dry: boolean; target: Bullet | null; cannons: { angle: number; timer: number }[]; firing: boolean };
  /** Time Dilation: seconds left of everything except your fleet running slow. */
  timeDilation: number;
  /** Boost stamina, 0–1 (shown by the ring around the ship you fly). */
  boostStamina: number;
  /** True after the bar ran dry, until it refills to CONFIG.boost.restartAt. */
  boostLocked: boolean;
  /** Seconds since you last boosted (the bar refills after CONFIG.boost.rechargeDelay). */
  boostRest: number;
  stats: RunStats;
  history: HistoryPoint[];
  /** Highest fleet value reached this run (the score). */
  maxFleetSize: number;
  /** Highest ship tier reached this run. */
  maxTier: number;
  zoom: number;
  gameOver: boolean;
  /** Test mode: your ships take no damage. */
  invincible: boolean;
  nextId: number;
  /** How long an effect's animation lasts. Comes from the art, so it's passed in. */
  effectDuration: (sprite: string, tier: number) => number;
}

/** What the player is doing this step. Aim is in world coordinates. */
export interface Controls {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  boost: boolean;
  /** Dash pressed this step (Space). */
  dash: boolean;
  /** Right click pressed this step: use your defence skills. */
  defend: boolean;
  /** Right click held (Force Wall draws while it's held). */
  defendHeld?: boolean;
}

export const typeOf = (ship: Ship): ShipType => SHIP_TYPES[ship.type];

// ---------- Tiers ----------

/** How many tier-1 ships a ship of this tier is worth (1, 16, 256...). */
export const tierValue = (tier: number) => CONFIG.tiers.shipsPerMerge ** (tier - 1);

/** Total worth of a fleet in tier-1 ships. */
export const fleetValue = (fleet: Fleet) => fleet.members.reduce((sum, s) => sum + tierValue(s.tier), 0);

/** All tier numbers (health, damage, shot speed...) for a ship type, team and tier. */
export function statsFor(type: ShipTypeId, team: Team, tier: number): ShipStats {
  const t = SHIP_TYPES[type];
  const T = CONFIG.tiers;
  const k = tier - 1;
  const size = T.sizePerTier ** k;
  const power = T.powerPerTier ** k;
  const shots = tier === 1 ? 1 : T.shotsPerVolley;
  // Slower firing is made up for by harder shots, so damage per second is unchanged.
  const slower = T.fireIntervalPerTier ** k;
  const bulletSpeed = t.bulletSpeed * T.shotSpeedPerTier ** k;
  const travel = t.bulletSpeed * t.bulletLife * T.rangePerTier ** k;
  return {
    radius: t.radius * size,
    maxHp: Math.round(t.maxHp * power * (team === 'player' ? CONFIG.playerHpMultiplier : 1)),
    shots,
    bulletDamage: (t.bulletDamage * power * slower) / shots,
    bulletSpeed,
    bulletLife: travel / bulletSpeed,
    bulletRadius: 2 * (size - 1),
    range: t.range * T.rangePerTier ** k,
    gunOffset: t.gunOffset * size,
    fireCooldown: t.fireCooldown * slower,
    turnRate: t.turnRate * T.turnRatePerTier ** k,
    size,
  };
}

/**
 * How many ships of each tier a fleet of this value has: [tier 1, tier 2, ...].
 * Below the merge threshold it's all tier 1. Above it, it's like writing the
 * value in base 16 (e.g. 300 = 1 × 256 + 2 × 16 + 12).
 */
export function tierCounts(value: number): number[] {
  const per = CONFIG.tiers.shipsPerMerge;
  if (value < CONFIG.tiers.mergeStartsAt) return [value];
  const counts: number[] = [];
  for (let v = value; v > 0; v = Math.floor(v / per)) counts.push(v % per);
  return counts;
}

// ---------- Setup ----------

export function createGame(effectDuration: (sprite: string, tier: number) => number): GameState {
  const state: GameState = {
    time: 0,
    survived: 0,
    ships: [],
    bullets: [],
    wrecks: [],
    effects: [],
    debris: [],
    shake: { time: 0, strength: 0 },
    gameOverAt: 0,
    finalBlow: null,
    merges: [],
    sounds: [],
    playerFleet: newFleet('player'),
    enemyFleets: [],
    wave: 0,
    waveTimer: CONFIG.firstWaveDelay,
    dashCooldown: 0,
    level: 1,
    xp: 0,
    pendingLevels: 0,
    cardDelay: 0,
    cardWaitUntil: 0,
    cards: null,
    skills: [],
    activeWeapon: 0,
    cardBonus: { damage: 0, fireRate: 0 },
    skillBonus: {},
    bonus: noBonus(),
    items: [],
    slots: Array(CONFIG.items.slotsPerTier * CONFIG.items.maxSlotTier).fill(null),
    unlockedTier: 1,
    equipmentChanged: false,
    loot: [],
    found: null,
    looted: 0,
    mergeLevel: 0,
    mergeAllow: defaultMergeAllow(),
    mergeOrder: 'low',
    autoMerge: false,
    unlocked: null,
    beams: [],
    mines: [],
    skillObjs: [],
    elitesEnabled: CONFIG.elite.enabled,
    elitesSpawned: 0,
    eliteDue: false,
    eliteAlertTime: -Infinity,
    swarmAlertTime: -Infinity,
    eliteAlertSkills: [],
    pdc: { ammo: 1, dry: false, target: null, cannons: [{ angle: 0, timer: 0 }, { angle: 0, timer: 0 }], firing: false },
    timeDilation: 0,
    boostStamina: 1,
    boostLocked: false,
    boostRest: 0,
    stats: emptyStats(),
    history: [{ time: 0, wave: 0, value: 1 }],
    maxFleetSize: 1,
    maxTier: 1,
    zoom: CONFIG.zoomSteps[0].zoom,
    gameOver: false,
    invincible: false,
    nextId: 1,
    effectDuration,
  };
  const flagship = addShip(state, 'player', 'fighter', 1, state.playerFleet, 0, 0, -Math.PI / 2);
  state.playerFleet.leader = flagship;
  return state;
}

/** Zoom follows the biggest fleet/tier you've had, so it doesn't jump back and forth in a fight. */
export function zoomFor(state: GameState) {
  let zoom = Infinity;
  for (const step of CONFIG.zoomSteps) {
    const reached = state.maxFleetSize >= (step.minFleet ?? 0) && state.maxTier >= (step.minTier ?? 0);
    if (reached) zoom = Math.min(zoom, step.zoom);
  }
  return zoom;
}

/**
 * Replace your fleet with a fresh one worth `value` (resuming an interrupted
 * run): the same ships merging would give (tierCounts), around the middle,
 * flown by one of the biggest. Everything else on the field is cleared.
 */
export function rebuildPlayerFleet(state: GameState, value: number) {
  state.ships = [];
  state.bullets = [];
  state.wrecks = [];
  state.effects = [];
  state.merges = [];
  state.beams = [];
  state.mines = [];
  state.skillObjs = [];
  state.loot = [];
  state.debris = [];
  state.finalBlow = null;
  state.enemyFleets = [];
  state.playerFleet = newFleet('player');
  const counts = tierCounts(Math.max(1, Math.round(value)));
  let leader: Ship | null = null;
  for (let tier = counts.length; tier >= 1; tier--)
    for (let i = 0; i < counts[tier - 1]; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = leader ? 60 + Math.random() * 60 : 0;
      const ship = addShip(state, 'player', 'fighter', tier, state.playerFleet, Math.cos(a) * r, Math.sin(a) * r, -Math.PI / 2);
      leader ??= ship;
    }
  state.playerFleet.leader = leader;
}

function addShip(
  state: GameState,
  team: Team,
  type: ShipTypeId,
  tier: number,
  fleet: Fleet,
  x: number,
  y: number,
  angle: number,
) {
  const stats = shipStats(state, type, team, tier);
  const ship: Ship = {
    id: state.nextId++,
    team,
    type,
    tier,
    stats,
    x,
    y,
    vx: 0,
    vy: 0,
    angle,
    hp: stats.maxHp,
    fireTimer: Math.random() * 0.5,
    fleet,
    dead: false,
    merge: null,
    absorbed: false,
    thrust: 'idle',
    frozen: 0,
    scrambled: 0,
    scrambleAngle: 0,
    scrambleTimer: 0,
    hijacked: 0,
    hijackedFrom: null,
    ghost: null,
    shield: 0,
    shieldTime: 0,
    elite: null,
    quirk: {
      phaseX: Math.random() * Math.PI * 2,
      phaseY: Math.random() * Math.PI * 2,
      speedX: randRange(CONFIG.driftSpeedMin, CONFIG.driftSpeedMax),
      speedY: randRange(CONFIG.driftSpeedMin, CONFIG.driftSpeedMax),
      delay: Math.random() * CONFIG.followDelayRandom,
    },
  };
  state.ships.push(ship);
  fleet.members.push(ship);
  return ship;
}

/** A ship's tier stats, with your fleet's health bonus (equipment) for your ships, and the wave's health growth for enemies. */
function shipStats(state: GameState, type: ShipTypeId, team: Team, tier: number) {
  const stats = statsFor(type, team, tier);
  if (team === 'player') stats.maxHp = Math.round(stats.maxHp * state.bonus.health);
  else stats.maxHp = Math.max(1, Math.round(stats.maxHp * enemyHealthMultiplier(state.wave)));
  return stats;
}

/** The ship the player is currently flying (null if the whole fleet is gone). */
export const controlledShip = (state: GameState) => state.playerFleet.leader;

/** True for a ship flying into another one to merge (not the one it merges into). */
export const isMergePart = (s: Ship) => s.merge !== null && s.merge.core !== s;

// ---------- Formation ----------

/** Room each ship needs in a formation. Grows with tier. */
const spacingOf = (s: Ship) => CONFIG.formationSpacing * s.stats.size;

/** Followers in formation order: biggest ships first (inner rings), then oldest first. */
const formationOrder = (followers: Ship[]) => followers.sort((a, b) => b.tier - a.tier || a.id - b.id);

/**
 * Spots around the leader for each follower (already in formation order).
 * Ships fill rings around the leader. Each ring holds one tier, spaced to fit
 * that tier, and a ring that isn't full spreads its ships evenly.
 * With only tier-1 ships this gives rings of 6, 12, 18...
 */
function formationSlots(leader: Ship, followers: Ship[]) {
  const slots: { x: number; y: number; ring: number }[] = [];
  let ring = 0;
  let prevRadius = 0;
  let prevSpacing = spacingOf(leader);
  let i = 0;
  while (i < followers.length) {
    ring++;
    const tier = followers[i].tier;
    const spacing = spacingOf(followers[i]);
    const radius = prevRadius + (prevSpacing + spacing) / 2;
    const capacity = Math.max(1, Math.floor((2 * Math.PI * radius) / spacing));
    let n = 0;
    while (i + n < followers.length && n < capacity && followers[i + n].tier === tier) n++;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + (ring % 2 === 0 ? Math.PI / n : 0) - Math.PI / 2;
      slots.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius, ring });
    }
    i += n;
    prevRadius = radius;
    prevSpacing = spacing;
  }
  return slots;
}

/** Remember where the leader is this step. Starts fresh when the leader changes. */
function recordTrail(fleet: Fleet, leader: Ship, dt: number) {
  const sample = { x: leader.x, y: leader.y, vx: leader.vx, vy: leader.vy, angle: leader.angle, boosting: leader.thrust === 'boost' };
  if (fleet.trailLeaderId !== leader.id) {
    fleet.trail = [];
    fleet.trailLeaderId = leader.id;
  }
  fleet.trail.push(sample);
  const keep = Math.ceil(CONFIG.followDelayMaxTotal / dt) + 1;
  if (fleet.trail.length > keep) fleet.trail.splice(0, fleet.trail.length - keep);
}

/** Where the leader was `delay` seconds ago (or as far back as we remember). */
function trailAt(fleet: Fleet, delay: number, dt: number): LeaderSample {
  const back = Math.min(Math.round(delay / dt), fleet.trail.length - 1);
  return fleet.trail[fleet.trail.length - 1 - back];
}

// ---------- Update ----------

export function updateGame(state: GameState, controls: Controls, dt: number, spawnDistance: number) {
  state.time += dt;
  updateEffects(state, dt);
  updateDebris(state, dt);
  // After the end, the world keeps going for a moment so you see your flagship go up; then it stops.
  if (state.gameOver && state.time - state.gameOverAt >= CONFIG.death.screenDelay) return;
  if (!state.gameOver) state.survived += dt;
  // Time Dilation: everything except your fleet runs slow (enemies, their shots and skills).
  state.timeDilation = Math.max(0, state.timeDilation - dt);
  const edt = state.timeDilation > 0 ? dt * CONFIG.timeDilation.slowTo : dt;
  const dtOf = (s: Ship) => (s.team === 'player' ? dt : edt);
  state.dashCooldown = Math.max(0, state.dashCooldown - dt);
  for (const f of [state.playerFleet, ...state.enemyFleets]) f.dashTime = Math.max(0, f.dashTime - (f.team === 'player' ? dt : edt));

  updatePlayerLeader(state, controls, dt);
  for (const fleet of [state.playerFleet, ...state.enemyFleets]) updateFleet(state, fleet, fleet.team === 'player' ? dt : edt);
  updateSkills(state, controls, dt);
  updateEliteSkills(state, edt);
  updateScrambled(state, dt);
  updateHijacked(state, dt);
  updateMerges(state, dt);
  separateShips(state, dt);

  for (const s of state.ships) {
    // Frozen enemies hang still (Freeze skill). Your frozen ships can still move, but not shoot.
    if (s.frozen > 0) {
      s.frozen = Math.max(0, s.frozen - dt);
      if (s.team === 'enemy') {
        s.vx = s.vy = 0;
        continue;
      }
    }
    s.x += s.vx * dtOf(s);
    s.y += s.vy * dtOf(s);
    s.fireTimer -= dtOf(s);
  }

  updateBullets(state, dt, edt);
  removeDeadShips(state);
  updateWrecks(state, dt);
  updateLoot(state, dt);
  startMerges(state);
  promoteFlagship(state);
  if (state.gameOver) return;
  updateWaves(state, dt, spawnDistance);
  // A level-up shows its cards after a short delay, so the kill that caused it can play out first.
  if (!state.cards && state.pendingLevels > 0) {
    state.cardDelay += dt;
    if (state.cardDelay >= CONFIG.levels.cardDelay && state.time >= state.cardWaitUntil) {
      state.cardDelay = 0;
      state.cards = drawCards(state);
    }
  }

  const fleet = state.playerFleet;
  state.maxFleetSize = Math.max(state.maxFleetSize, fleetValue(fleet));
  for (const s of fleet.members) state.maxTier = Math.max(state.maxTier, s.tier);
  unlockSlots(state);
  state.zoom = zoomFor(state);
  if (fleet.members.length === 0) {
    state.gameOver = true;
    state.gameOverAt = state.time;
    state.history.push({ time: state.survived, wave: state.wave, value: 0 });
    addSound(state, 'sfx.gameover', { x: 0, y: 0 }, 1, 1, true);
  }
}

/** Steer a ship's velocity toward a desired velocity, limited by its acceleration. */
function steer(ship: Ship, wantVx: number, wantVy: number, accel: number, dt: number) {
  const dvx = wantVx - ship.vx;
  const dvy = wantVy - ship.vy;
  const len = Math.hypot(dvx, dvy);
  const maxStep = accel * dt;
  if (len <= maxStep) {
    ship.vx = wantVx;
    ship.vy = wantVy;
  } else {
    ship.vx += (dvx / len) * maxStep;
    ship.vy += (dvy / len) * maxStep;
  }
}

/** Speed factor for moving in direction (mx, my) while facing `angle`: faster forward, slower backward. */
function directionFactor(angle: number, mx: number, my: number) {
  const ds = CONFIG.directionalSpeed;
  // 1 = moving straight ahead, 0 = sideways, -1 = backing straight away.
  const dot = mx * Math.cos(angle) + my * Math.sin(angle);
  return dot >= 0 ? 1 + (ds.forward - 1) * dot : 1 + (1 - ds.backward) * dot;
}

/** How much faster a fleet moves right now because of a dash (fades from its start power to 1×). */
function dashMultiplier(fleet: Fleet) {
  if (fleet.dashTime <= 0) return 1;
  return 1 + (fleet.dashPower - 1) * (fleet.dashTime / CONFIG.dash.duration);
}

function updatePlayerLeader(state: GameState, c: Controls, dt: number) {
  const ship = controlledShip(state);
  if (!ship || ship.dead) return;
  const fleet = state.playerFleet;
  const t = typeOf(ship);
  const len = Math.hypot(c.moveX, c.moveY);
  let mx = len > 0 ? c.moveX / len : 0;
  let my = len > 0 ? c.moveY / len : 0;
  if (c.dash && state.dashCooldown <= 0) startDash(state, fleet, ship, mx, my);
  // Dashing without steering keeps going in the dash direction.
  if (fleet.dashTime > 0 && len === 0) {
    mx = fleet.dashX;
    my = fleet.dashY;
  }
  const steering = mx !== 0 || my !== 0;
  // Boost only counts while you're actually steering somewhere. A dash outdoes it.
  const boosting = spendBoostStamina(state, ship, c.boost && len > 0, dt);
  const mul = Math.max(boosting ? t.boostMultiplier * state.bonus.boostSpeed : 1, dashMultiplier(fleet));
  const speed = t.maxSpeed * state.bonus.speed * mul * directionFactor(ship.angle, mx, my);
  steer(ship, mx * speed, my * speed, t.accel * mul, dt);
  if (boosting && ship.thrust !== 'boost') addSound(state, 'sfx.boost', ship, ship.tier);
  // A dash doesn't change the thrusters (only Shift boost does).
  ship.thrust = boosting ? 'boost' : steering ? 'move' : 'idle';
  ship.angle = turnToward(ship.angle, Math.atan2(c.aimY - ship.y, c.aimX - ship.x), ship.stats.turnRate * dt);
  if (c.fire && ship.fireTimer <= 0 && !ship.merge && ship.frozen <= 0) fire(state, ship, ship.stats.fireCooldown, 0);
}

/**
 * Shift boost drains stamina while held and refills after a short rest. Running
 * dry locks boost until the bar is partly refilled, so it doesn't stutter on and off.
 * Returns whether the ship boosts this step.
 */
function spendBoostStamina(state: GameState, ship: Ship, wants: boolean, dt: number) {
  const b = CONFIG.boost;
  if (wants && !state.boostLocked && state.boostStamina > 0) {
    // Bigger ships have more boost time.
    const duration = b.duration * b.durationPerTier ** (ship.tier - 1) * state.bonus.stamina;
    state.boostStamina = Math.max(0, state.boostStamina - dt / duration);
    state.boostRest = 0;
    if (state.boostStamina === 0) state.boostLocked = true;
    return true;
  }
  state.boostRest += dt;
  if (state.boostRest >= b.rechargeDelay) state.boostStamina = Math.min(1, state.boostStamina + dt / b.rechargeTime);
  if (state.boostStamina >= b.restartAt) state.boostLocked = false;
  return false;
}

/**
 * Space: every ship in the fleet is kicked to 8× speed at once (more when
 * zoomed out), in the direction you're steering or where you face, fading back
 * over half a second.
 */
function startDash(state: GameState, fleet: Fleet, leader: Ship, mx: number, my: number) {
  const d = CONFIG.dash;
  if (mx === 0 && my === 0) {
    mx = Math.cos(leader.angle);
    my = Math.sin(leader.angle);
  }
  // Zoomed out, the screen shows more of the world, so the dash gets stronger to match.
  const zoomScale = d.scaleWithZoom ? CONFIG.zoomSteps[0].zoom / state.zoom : 1;
  fleet.dashPower = 1 + (d.speedMultiplier - 1) * zoomScale;
  const speed = typeOf(leader).maxSpeed * state.bonus.speed * directionFactor(leader.angle, mx, my) * fleet.dashPower;
  fleet.dashTime = d.duration;
  fleet.dashHits = new Set();
  fleet.dashX = mx;
  fleet.dashY = my;
  state.dashCooldown = d.cooldown;
  for (const s of fleet.members) {
    if (isMergePart(s)) continue;
    s.vx = mx * speed;
    s.vy = my * speed;
  }
  addSound(state, 'sfx.dash', leader, leader.tier);
}

/** A direction (radians) and how far either side of it a ship may aim. */
export interface FireArc {
  center: number;
  half: number;
}

/** Nearest enemy within `maxDist` (and inside `arc`, if given). */
export function findNearestEnemy(state: GameState, ship: Ship, maxDist: number, arc?: FireArc): Ship | null {
  let best: Ship | null = null;
  let bestD = maxDist * maxDist;
  for (const real of state.ships) {
    if (real.team === ship.team || real.dead || real.merge) continue;
    // A cloaked ship can't be seen: aim at where it was last seen instead.
    const other = real.ghost ?? real;
    const d = distSq(ship.x, ship.y, other.x, other.y);
    if (d >= bestD) continue;
    if (arc && Math.abs(wrapAngle(Math.atan2(other.y - ship.y, other.x - ship.x) - arc.center)) > arc.half) continue;
    bestD = d;
    best = other;
  }
  return best;
}

function updateFleet(state: GameState, fleet: Fleet, dt: number) {
  const leader = fleet.leader;
  if (!leader) return;
  if (fleet.team === 'enemy') updateEnemyLeader(state, leader, dt);
  recordTrail(fleet, leader, dt);

  // Ships flying into a merge are steered by updateMerges instead.
  const followers = formationOrder(fleet.members.filter((s) => s !== leader && !isMergePart(s)));
  // A swarm chevron keeps its V shape; other fleets fly in rings.
  const slots = fleet.swarm ? [] : formationSlots(leader, followers);
  followers.forEach((ship, i) => {
    const t = typeOf(ship);
    const q = ship.quirk;
    const speedMul = ship.team === 'enemy' ? CONFIG.enemySpeedMultiplier : 1;
    const chevron = fleet.swarm ? (fleet.swarm.slots.get(ship.id) ?? { x: 0, y: 0, row: 0 }) : null;
    const ring = chevron ? chevron.row + 1 : slots[i].ring;
    // React to where the leader was a moment ago. Outer rings react later,
    // so turns ripple outward through the formation.
    // During a dash everyone follows the leader with no delay, so the formation stays together.
    const dashing = fleet.dashTime > 0;
    const delay = dashing ? 0 : CONFIG.followDelay + (ring - 1) * CONFIG.followDelayPerRing + q.delay;
    const past = trailAt(fleet, delay, dt);
    const off = chevron ? chevronSpot(chevron, past) : slots[i];
    // Each ship drifts gently around its spot in its own slow loop.
    const driftX = Math.sin(state.time * q.speedX * Math.PI * 2 + q.phaseX) * CONFIG.driftAmount;
    const driftY = Math.sin(state.time * q.speedY * Math.PI * 2 + q.phaseY) * CONFIG.driftAmount;
    // Fly toward the spot, matching the (delayed) leader's speed.
    const tx = past.x + off.x + driftX - ship.x;
    const ty = past.y + off.y + driftY - ship.y;
    let wantVx = past.vx + tx * CONFIG.followStiffness;
    let wantVy = past.vy + ty * CONFIG.followStiffness;
    const wantLen = Math.hypot(wantVx, wantVy);
    // Your fleet's speed and boost-speed bonuses (equipment) apply to every ship in it.
    const yours = ship.team === 'player';
    const boostMul = Math.max(past.boosting ? t.boostMultiplier * (yours ? state.bonus.boostSpeed : 1) : 1, dashMultiplier(fleet));
    const maxV = t.maxSpeed * speedMul * (yours ? state.bonus.speed : 1) * 1.5 * boostMul;
    if (wantLen > maxV) {
      wantVx *= maxV / wantLen;
      wantVy *= maxV / wantLen;
    }
    steer(ship, wantVx, wantVy, t.accel * boostMul, dt);
    const moving = Math.hypot(ship.vx, ship.vy) > MOVING_SPEED;
    // When the leader boosts, the whole formation boosts to keep up (a dash doesn't change the thrusters).
    ship.thrust = !moving ? 'idle' : past.boosting ? 'boost' : 'move';
    // With nothing to shoot, face where the leader faced, swaying a little.
    const sway = Math.sin(state.time * q.speedX * Math.PI * 2 + q.phaseY) * CONFIG.idleSway;
    // Only shoot at things roughly in front of the leader (where it faces right now).
    const arcDeg = ship.team === 'enemy' ? CONFIG.enemyFireArc : CONFIG.allyFireArc;
    aimAndShoot(state, ship, dt, past.angle + sway, { center: leader.angle, half: (arcDeg * Math.PI) / 180 });
  });
}

/**
 * AI: turn toward the nearest enemy in range and shoot. Otherwise face `idleAngle`.
 * With an `arc`, only targets inside it count and the ship never turns outside it.
 */
function aimAndShoot(state: GameState, ship: Ship, dt: number, idleAngle: number, arc?: FireArc) {
  // Frozen ships can't aim; scrambled ones turn and shoot at random (updateScrambled).
  if (ship.frozen > 0 || ship.scrambled > 0) return;
  // An elite holds still while its laser warning shows, so the warning line is where the beam will go.
  if (ship.elite && ship.elite.laserCharge > 0) return;
  // Merging ships hold fire.
  const target = ship.merge ? null : findNearestEnemy(state, ship, ship.stats.range, arc);
  if (!target) {
    ship.angle = turnToward(ship.angle, idleAngle, ship.stats.turnRate * dt);
    return;
  }
  const enemy = ship.team === 'enemy';
  let aimX = target.x;
  let aimY = target.y;
  if (enemy ? CONFIG.enemyLeadsTargets : CONFIG.allyLeadsTargets) {
    // Aim where the target will be when the bullet arrives.
    const travel = Math.hypot(target.x - ship.x, target.y - ship.y) / ship.stats.bulletSpeed;
    aimX += target.vx * travel;
    aimY += target.vy * travel;
  }
  let want = Math.atan2(aimY - ship.y, aimX - ship.x);
  // Aiming ahead of a moving target must not take the ship outside its arc.
  if (arc) want = arc.center + clamp(wrapAngle(want - arc.center), -arc.half, arc.half);
  ship.angle = turnToward(ship.angle, want, ship.stats.turnRate * dt);
  if (ship.fireTimer <= 0 && Math.abs(wrapAngle(want - ship.angle)) < 0.25) {
    const mul = enemy ? CONFIG.enemyFireCooldownMultiplier : CONFIG.allyFireCooldownMultiplier;
    const spread = enemy ? CONFIG.enemyAimSpread : CONFIG.allyAimSpread;
    fire(state, ship, ship.stats.fireCooldown * mul * randRange(0.85, 1.15), spread);
  }
}

/** A chevron spot (behind the leader) turned to where the leader is heading. */
function chevronSpot(spot: { x: number; y: number }, past: LeaderSample) {
  const heading = Math.hypot(past.vx, past.vy) > MOVING_SPEED ? Math.atan2(past.vy, past.vx) : past.angle;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return { x: spot.x * c - spot.y * s, y: spot.x * s + spot.y * c };
}

function updateEnemyLeader(state: GameState, ship: Ship, dt: number) {
  const t = typeOf(ship);
  const speed = t.maxSpeed * CONFIG.enemySpeedMultiplier;
  const target = findNearestEnemy(state, ship, Infinity);
  if (!target) {
    steer(ship, 0, 0, t.accel, dt);
    return;
  }
  const dx = target.x - ship.x;
  const dy = target.y - ship.y;
  const d = Math.hypot(dx, dy) || 1;
  const swarm = ship.fleet.swarm;
  if (swarm) {
    // A swarm chevron doesn't fly straight at you: it heads a little to one side,
    // so it curves in. The angle shrinks as it gets close, so it swirls past and around you.
    const S = CONFIG.swarm;
    const far = clamp(d / swarm.from, 0, 1);
    const off = ((S.curveNear + (S.curveFar - S.curveNear) * far) * Math.PI) / 180;
    const heading = Math.atan2(dy, dx) + off * swarm.turn;
    steer(ship, Math.cos(heading) * speed, Math.sin(heading) * speed, t.accel, dt);
    aimAndShoot(state, ship, dt, heading);
    ship.thrust = Math.hypot(ship.vx, ship.vy) > MOVING_SPEED ? 'move' : 'idle';
    return;
  }
  const nx = dx / d;
  const ny = dy / d;
  // A big enemy fleet charges in. A lone fighter keeps its distance and circles.
  const preferred =
    ship.fleet.members.length > 3 ? 60 + ship.stats.radius + target.stats.radius : CONFIG.enemyPreferredDistance;
  if (d > preferred) {
    steer(ship, nx * speed, ny * speed, t.accel, dt);
  } else {
    const dir = ship.id % 2 ? 1 : -1;
    steer(ship, -ny * speed * 0.6 * dir, nx * speed * 0.6 * dir, t.accel, dt);
  }
  aimAndShoot(state, ship, dt, Math.atan2(dy, dx));
  ship.thrust = Math.hypot(ship.vx, ship.vy) > MOVING_SPEED ? 'move' : 'idle';
}

/**
 * Hijack a ship for `duration` seconds: it leaves its fleet and fights alone for
 * the other side (it flies at and shoots its old allies), then switches back.
 */
export function hijackShip(state: GameState, s: Ship, duration: number) {
  if (s.hijacked > 0 || s.merge || s.dead) return;
  const from = s.team;
  leaveFleet(state, s);
  // On its own, it flies and fights like a lone enemy fighter does (updateEnemyLeader).
  const solo = newFleet('enemy');
  solo.leader = s;
  solo.members.push(s);
  s.fleet = solo;
  state.enemyFleets.push(solo);
  s.team = from === 'player' ? 'enemy' : 'player';
  s.hijackedFrom = from;
  s.hijacked = duration;
  s.ghost = null;
}

/** Take a ship out of its fleet (a new leader takes over if it was leading). */
function leaveFleet(state: GameState, s: Ship) {
  const fleet = s.fleet;
  fleet.members = fleet.members.filter((m) => m !== s);
  if (fleet.leader === s) fleet.leader = pickNewLeader(fleet, s);
  if (fleet === state.playerFleet && fleet.leader) addSound(state, 'sfx.command', s, 1, 1, true);
}

/** Hijacked ships count down; when it ends they switch back (yours rejoin your fleet). */
function updateHijacked(state: GameState, dt: number) {
  for (const s of state.ships) {
    if (s.hijacked <= 0 || s.dead) continue;
    s.hijacked -= dt;
    if (s.hijacked > 0) continue;
    s.hijacked = 0;
    s.team = s.hijackedFrom ?? s.team;
    if (s.hijackedFrom === 'player' && !state.gameOver) {
      leaveFleet(state, s);
      s.fleet = state.playerFleet;
      state.playerFleet.members.push(s);
    }
    s.hijackedFrom = null;
  }
}

/**
 * Scrambled ships (Scramble skill) ignore their orders: each turns toward a
 * random direction (a new one every CONFIG.scramble.changeEvery seconds), drifts
 * that way, and fires wherever it happens to face.
 */
function updateScrambled(state: GameState, dt: number) {
  const S = CONFIG.scramble;
  for (const s of state.ships) {
    if (s.scrambled <= 0) continue;
    s.scrambled = Math.max(0, s.scrambled - dt);
    if (s.frozen > 0 || s.merge) continue;
    s.scrambleTimer -= dt;
    if (s.scrambleTimer <= 0) {
      s.scrambleTimer = S.changeEvery;
      s.scrambleAngle = Math.random() * Math.PI * 2;
    }
    const t = typeOf(s);
    s.angle = turnToward(s.angle, s.scrambleAngle, s.stats.turnRate * 2 * dt);
    const speed = t.maxSpeed * S.scrambledSpeed * (s.team === 'enemy' ? CONFIG.enemySpeedMultiplier : 1);
    steer(s, Math.cos(s.angle) * speed, Math.sin(s.angle) * speed, t.accel, dt);
    if (s.fireTimer <= 0) {
      const enemy = s.team === 'enemy';
      const mul = enemy ? CONFIG.enemyFireCooldownMultiplier : CONFIG.allyFireCooldownMultiplier;
      fire(state, s, s.stats.fireCooldown * mul * randRange(0.85, 1.15), enemy ? CONFIG.enemyAimSpread : CONFIG.allyAimSpread);
    }
  }
}

/**
 * Gently push apart ships of the same team that overlap. A fleet's leader is
 * never pushed by its own followers: they move aside instead, so the ship you
 * fly always goes exactly where you steer.
 */
function separateShips(state: GameState, dt: number) {
  const ships = state.ships;
  for (let i = 0; i < ships.length; i++)
    for (let j = i + 1; j < ships.length; j++) {
      const a = ships[i];
      const b = ships[j];
      if (a.team !== b.team || a.merge || b.merge) continue;
      // Your ships can pass over/under each other (as if at different heights).
      if (a.team === 'player' && !CONFIG.playerShipsCollide) continue;
      const minD = a.stats.radius + b.stats.radius;
      const d2 = distSq(a.x, a.y, b.x, b.y);
      if (d2 >= minD * minD || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = ((minD - d) / d) * 200 * dt;
      const px = (a.x - b.x) * push;
      const py = (a.y - b.y) * push;
      const sameFleet = a.fleet === b.fleet;
      const aLeads = sameFleet && a.fleet.leader === a;
      const bLeads = sameFleet && b.fleet.leader === b;
      // Normally both share the push. If one is the leader, the other takes all of it.
      const aShare = aLeads ? 0 : bLeads ? 2 : 1;
      const bShare = bLeads ? 0 : aLeads ? 2 : 1;
      a.vx += px * aShare;
      a.vy += py * aShare;
      b.vx -= px * bShare;
      b.vy -= py * bShare;
    }
}

/** Fire one volley. Bigger tiers fire several shots side by side. */
function fire(state: GameState, ship: Ship, cooldown: number, spread: number) {
  const st = ship.stats;
  // Your fleet's fire-rate bonus makes the wait between volleys shorter.
  ship.fireTimer = ship.team === 'player' ? cooldown / state.bonus.fireRate : cooldown;
  const a = ship.angle + randRange(-spread, spread);
  const fx = Math.cos(ship.angle);
  const fy = Math.sin(ship.angle);
  // One sound per volley. Your wingmen are quieter than the ship you fly.
  const enemy = ship.team === 'enemy';
  const volume = enemy || ship === controlledShip(state) ? 1 : CONFIG.audio.allyShotVolume;
  addSound(state, enemy ? 'sfx.shoot.enemy' : 'sfx.shoot', ship, ship.tier, volume);
  for (let i = 0; i < st.shots; i++) {
    // Spread the guns across the ship's width.
    const side = st.shots === 1 ? 0 : (i / (st.shots - 1) - 0.5) * st.radius * 0.8;
    addBullet(state, ship, ship.x + fx * st.gunOffset - fy * side, ship.y + fy * st.gunOffset + fx * side, a);
  }
}

/** One shot from `ship` (with its tier's damage, speed and range), starting at (x, y). */
/**
 * Extra speed a shot fired at `angle` gets from its ship's movement (CONFIG.shotInherit): the part of the
 * ship's velocity along the shot (never negative), capped at the ship's normal top speed so boost and
 * dash add nothing extra.
 */
export function inheritedSpeed(state: GameState, ship: Ship, angle: number) {
  const I = CONFIG.shotInherit;
  const along = ship.vx * Math.cos(angle) + ship.vy * Math.sin(angle);
  if (along <= 0 || I.share <= 0) return 0;
  const top = typeOf(ship).maxSpeed * (ship.team === 'player' ? state.bonus.speed : 1) * CONFIG.directionalSpeed.forward;
  return (I.capAtTopSpeed ? Math.min(along, top) : along) * I.share;
}

function addBullet(state: GameState, ship: Ship, x: number, y: number, angle: number, source: DamageSource = 'gun') {
  const st = ship.stats;
  // Faster when the ship flies the same way; it lasts a little less, so its reach stays the same.
  const speed = st.bulletSpeed + inheritedSpeed(state, ship, angle);
  state.bullets.push({
    // A ship you took over (Hijack) fighting for you counts as Hijack's work.
    source: ship.hijackedFrom === 'enemy' && ship.team === 'player' ? 'hijack' : source,
    team: ship.team,
    sprite: typeOf(ship).sprites.bullet,
    tier: ship.tier,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: (st.bulletLife * st.bulletSpeed) / speed,
    damage: st.bulletDamage * (ship.team === 'player' ? state.bonus.damage : 1),
    radius: st.bulletRadius,
    homing: 0,
    target: null,
  });
}

/**
 * Damage a ship: a Shield soaks it up first, then health. Your ships take no
 * damage in invincible test mode. Returns true if this destroyed it.
 */
export function damageShip(state: GameState, s: Ship, amount: number, source: DamageSource = 'gun') {
  if (s.dead) return false;
  if (s.shield > 0) {
    const absorbed = Math.min(s.shield, amount);
    s.shield -= absorbed;
    amount -= absorbed;
  }
  if (!(s.team === 'player' && state.invincible)) s.hp -= amount;
  if (s.hp <= 0) {
    s.dead = true;
    s.killedBy = source;
  }
  return s.dead;
}

/** Turn a homing missile toward its target, or the nearest enemy if its target is gone. */
/**
 * A missile's flight (times in CONFIG.missiles): it drifts out of the ship,
 * turns to face its target, then speeds up to top speed while homing in.
 */
function steerMissile(state: GameState, b: Bullet, dt: number) {
  const M = CONFIG.missiles;
  // Out of fuel: no more thrust or steering, it just tumbles and slows down.
  if (b.spent) {
    b.facing = (b.facing ?? 0) + (b.spin ?? 0) * dt;
    const keep = Math.max(0, 1 - M.tumbleDrag * dt);
    b.vx *= keep;
    b.vy *= keep;
    return;
  }
  const age = M.life - b.life;
  // Fire up: light the thruster (drawn in render.ts), with its own small sound.
  if (!b.lit && b.igniteAt !== undefined && age >= b.igniteAt) {
    b.lit = true;
    addSound(state, 'sfx.missile-ignite', b, b.tier);
  }
  if (!b.target || b.target.dead || b.target.merge) b.target = retargetMissile(state, b);
  const facing = b.facing ?? Math.atan2(b.vy, b.vx);
  // No target (yet): head the way its ship faced at launch (it keeps looking for one meanwhile).
  const want = b.target ? Math.atan2(b.target.y - b.y, b.target.x - b.x) : (b.launchAngle ?? facing);
  // 1. Drifting straight out of the ship.
  if (age < M.ejectTime) return;
  // 2. Still drifting, turning to face the target.
  if (age < M.ejectTime + M.spinTime) {
    b.facing = facing + clamp(wrapAngle(want - facing), -M.spinRate * dt, M.spinRate * dt);
    return;
  }
  // 3. Speeding off along where it points, steering toward the target.
  b.boostFrom ??= Math.hypot(b.vx, b.vy);
  const t = Math.min(1, (age - M.ejectTime - M.spinTime) / M.rampTime);
  const speed = b.boostFrom + (M.speed - b.boostFrom) * t;
  b.facing = facing + clamp(wrapAngle(want - facing), -b.homing * dt, b.homing * dt);
  b.vx = Math.cos(b.facing) * speed;
  b.vy = Math.sin(b.facing) * speed;
}

/**
 * A new target for a missile whose target is gone (or that had none): an enemy
 * within lock range and inside the lock arc in front of the missile, the one
 * with the fewest missiles already on it (then the nearest), so the volley
 * keeps spreading across as many targets as it can.
 */
function retargetMissile(state: GameState, b: Bullet): Ship | null {
  const range = CONFIG.missiles.lockRange ** 2;
  const half = (CONFIG.missiles.lockArc * Math.PI) / 360;
  const facing = b.facing ?? Math.atan2(b.vy, b.vx);
  const onTarget = new Map<Ship, number>();
  for (const o of state.bullets) if (o !== b && o.homing > 0 && o.target) onTarget.set(o.target, (onTarget.get(o.target) ?? 0) + 1);
  let best: Ship | null = null;
  let bestN = Infinity;
  let bestD = Infinity;
  for (const s of state.ships) {
    // Missiles can't lock onto cloaked ships.
    if (s.team === b.team || s.dead || s.merge || s.ghost) continue;
    const d = distSq(b.x, b.y, s.x, s.y);
    if (d > range || Math.abs(wrapAngle(Math.atan2(s.y - b.y, s.x - b.x) - facing)) > half) continue;
    const n = onTarget.get(s) ?? 0;
    if (n < bestN || (n === bestN && d < bestD)) {
      best = s;
      bestN = n;
      bestD = d;
    }
  }
  return best;
}

function updateBullets(state: GameState, playerDt: number, enemyDt: number) {
  for (const b of state.bullets) {
    // Enemy shots run slow during Time Dilation.
    const dt = b.team === 'player' ? playerDt : enemyDt;
    if (b.homing > 0) steerMissile(state, b, dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    // A missile whose fuel ran out goes dead: no flame or trail, tumbling, harmless.
    if (b.homing > 0 && !b.spent && b.life <= 0) {
      b.spent = true;
      b.lit = false;
      b.target = null;
      b.life = CONFIG.missiles.tumbleTime;
      b.spin = randRange(-1, 1) * CONFIG.missiles.tumbleSpin;
    }
    if (b.spent) {
      bounceOffShips(state, b);
      continue;
    }
    if (b.interceptor) {
      interceptMissiles(state, b);
      continue;
    }
    for (const s of state.ships) {
      // Merging ships can't be hit: shots pass through.
      if (s.team === b.team || s.dead || s.merge) continue;
      const r = s.stats.radius + b.radius;
      if (distSq(b.x, b.y, s.x, s.y) > r * r) continue;
      damageShip(state, s, b.damage, b.source);
      b.life = 0;
      if (b.homing > 0) {
        // Missiles burst in a small round explosion of their own.
        const e = addEffect(state, 'vfx.missile-hit', b.x, b.y, Math.random() * Math.PI * 2, b.tier);
        // It appears at the missile's impact point (placed in ShipArt).
        e.at = { sprite: b.sprite, tier: b.tier, angle: b.facing ?? Math.atan2(b.vy, b.vx), point: 'impact' };
        addSound(state, 'sfx.missile-hit', b, b.tier);
      } else {
        const e = addEffect(state, 'vfx.hit', b.x, b.y, 0, b.tier);
        // It appears at the shot's Hit point (placed in ShipArt).
        e.at = { sprite: b.sprite, tier: b.tier, angle: Math.atan2(b.vy, b.vx), point: 'hit' };
        addSound(state, 'sfx.hit', b, b.tier);
      }
      break;
    }
  }
  state.bullets = state.bullets.filter((b) => b.life > 0);
}

/** A dead missile bounces off any ship it touches (either side), doing no damage. */
function bounceOffShips(state: GameState, b: Bullet) {
  for (const s of state.ships) {
    if (s.dead || s.absorbed) continue;
    const r = s.stats.radius + b.radius;
    const dx = b.x - s.x;
    const dy = b.y - s.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    const d = Math.sqrt(d2) || 1;
    const nx = dx / d;
    const ny = dy / d;
    // Back out to the ship's edge, and bounce off it (relative to the ship's own movement).
    b.x = s.x + nx * r;
    b.y = s.y + ny * r;
    const into = (b.vx - s.vx) * nx + (b.vy - s.vy) * ny;
    if (into < 0) {
      b.vx -= 2 * into * nx;
      b.vy -= 2 * into * ny;
    }
  }
}

/** Seconds the "Elite incoming!" warning stays up: longer with Tech Scanner, so its skill list can be read. */
export const eliteAlertTime = (state: GameState) =>
  state.skills.some((sk) => sk.id === 'techScanner') ? CONFIG.elite.alertTimeScanner : CONFIG.elite.alertTime;

/** An enemy's class, for the kill stats: "elite", "swarm", "fleet" or "lone". New kinds of enemies go here. */
function enemyClass(s: Ship) {
  if (s.elite) return 'elite';
  if (s.fleet.swarm) return 'swarm';
  return s.inFleet ? 'fleet' : 'lone';
}

function removeDeadShips(state: GameState) {
  for (const s of state.ships) {
    if (!s.dead) continue;
    // The blow that destroys your last ship: it hangs on in slow motion first (see finalBlow).
    const fb = state.finalBlow;
    if (fb?.ship === s && !fb.ready) continue;
    if (!fb && CONFIG.death.slowmoTime > 0 && s.fleet === state.playerFleet && s.fleet.leader === s && s.fleet.members.every((m) => m.dead)) {
      state.finalBlow = { ship: s, ready: false };
      continue;
    }
    if (fb?.ship === s) state.finalBlow = null;
    // The ship you fly gets a bigger, unique explosion with flying debris.
    if (s.fleet === state.playerFleet && s.fleet.leader === s) flagshipExplosion(state, s);
    else {
      addEffect(state, 'vfx.explosion', s.x, s.y, Math.random() * Math.PI * 2, s.tier);
      addSound(state, 'sfx.explosion', s, s.tier);
    }
    // A hijacked ship still counts for the side it came from (yours: a loss; an enemy: XP and drops).
    const wasEnemy = (s.hijackedFrom ?? s.team) === 'enemy';
    if (wasEnemy) {
      const st = state.stats;
      const value = tierValue(s.tier);
      st.kills++;
      st.killValue += value;
      st.killsByTier[s.tier] = (st.killsByTier[s.tier] ?? 0) + 1;
      const cls = enemyClass(s);
      st.killsByClass[cls] = (st.killsByClass[cls] ?? 0) + 1;
      const by = (st.killsBySource[s.killedBy ?? 'gun'] ??= { kills: 0, value: 0 });
      by.kills++;
      by.value += value;
      const levels = state.pendingLevels;
      const xp = tierValue(s.tier) * CONFIG.levels.xpPerValue;
      // An elite gives more, but never more than CONFIG.elite.xpMaxLevels levels' worth.
      gainXp(state, s.elite ? Math.min(xp * CONFIG.elite.xpMultiplier, CONFIG.elite.xpMaxLevels * xpToNextLevel(state.level)) : xp);
      // Levelled up: the cards wait until this kill's explosion has finished playing.
      if (state.pendingLevels > levels)
        state.cardWaitUntil = Math.max(state.cardWaitUntil, state.time + state.effectDuration('vfx.explosion', s.tier));
      if (!s.elite) maybeDropItem(state, s);
    } else {
      state.stats.losses++;
      state.stats.lossValue += tierValue(s.tier);
    }
    // Bigger enemies leave wrecks less often.
    // Your first kill of a run always leaves one.
    const firstKill = wasEnemy && state.stats.kills === 1 && CONFIG.firstKillWreck;
    let wreckChance = firstKill ? 1 : CONFIG.wreckChance * CONFIG.tiers.wreckChancePerTier ** (s.tier - 1);
    let wreckTier = s.tier;
    if (s.elite) {
      // An elite always drops a wreck, a (better) item, or both.
      const drop = eliteDrop();
      if (drop !== 'wreck') dropItem(state, s, rarityWeights('elite'));
      wreckChance = firstKill || drop !== 'item' ? 1 : 0;
      // Its wreck never lets you jump too far ahead of your biggest ship.
      wreckTier = Math.min(s.tier, state.maxTier + CONFIG.elite.wreckMaxTiersAbove);
    }
    if (wasEnemy && Math.random() < wreckChance) {
      state.wrecks.push({
        type: s.type,
        tier: wreckTier,
        x: s.x,
        y: s.y,
        vx: s.vx * 0.3,
        vy: s.vy * 0.3,
        angle: s.angle,
        spin: randRange(-1, 1) / s.stats.size,
        life: CONFIG.wreckLifetime,
      });
    }
    const fleet = s.fleet;
    fleet.members = fleet.members.filter((m) => m !== s);
    if (fleet.leader === s) {
      fleet.leader = pickNewLeader(fleet, s);
      if (fleet === state.playerFleet && fleet.leader) addSound(state, 'sfx.command', s, 1, 1, true);
    }
  }
  state.ships = state.ships.filter((s) => !s.dead || s === state.finalBlow?.ship);
  state.enemyFleets = state.enemyFleets.filter((f) => f.members.length > 0);
}

/** What an elite drops: 'wreck', 'item' or 'both' (odds in CONFIG.elite). */
function eliteDrop(): 'wreck' | 'item' | 'both' {
  const E = CONFIG.elite;
  const roll = Math.random() * (E.dropWreckWeight + E.dropItemWeight + E.dropBothWeight);
  if (roll < E.dropWreckWeight) return 'wreck';
  if (roll < E.dropWreckWeight + E.dropItemWeight) return 'item';
  return 'both';
}


/** When a leader dies, the closest of the biggest surviving ships takes command. */
function pickNewLeader(fleet: Fleet, old: Ship): Ship | null {
  let best: Ship | null = null;
  let bestD = Infinity;
  for (const m of fleet.members) {
    if (isMergePart(m)) continue;
    const d = distSq(m.x, m.y, old.x, old.y);
    if (!best || m.tier > best.tier || (m.tier === best.tier && d < bestD)) {
      bestD = d;
      best = m;
    }
  }
  return best ?? fleet.members[0] ?? null;
}

/** You always fly one of your biggest ships: move into a bigger one when you get it. */
function promoteFlagship(state: GameState) {
  const fleet = state.playerFleet;
  const leader = fleet.leader;
  // A flagship that's being merged into will grow by itself.
  if (!leader || leader.merge) return;
  let best = leader;
  let bestD = Infinity;
  for (const m of fleet.members) {
    if (m.merge || m.tier <= leader.tier) continue;
    const d = distSq(m.x, m.y, leader.x, leader.y);
    if (m.tier > best.tier || (m.tier === best.tier && d < bestD)) {
      best = m;
      bestD = d;
    }
  }
  fleet.leader = best;
}

// ---------- Merging ----------

/** Once your fleet is big enough, every 16 ships of the same tier start merging. */
function startMerges(state: GameState) {
  const fleet = state.playerFleet;
  const per = CONFIG.tiers.shipsPerMerge;
  if (fleetValue(fleet) < CONFIG.tiers.mergeStartsAt) return;
  const byTier = new Map<number, Ship[]>();
  for (const s of fleet.members) {
    if (s.merge) continue;
    const list = byTier.get(s.tier) ?? [];
    list.push(s);
    byTier.set(s.tier, list);
  }
  for (const ships of byTier.values()) {
    while (ships.length >= per) {
      // The flagship is the core whenever it's in the group, so you keep flying it.
      const leaderIndex = fleet.leader ? ships.indexOf(fleet.leader) : -1;
      const [core] = ships.splice(leaderIndex >= 0 ? leaderIndex : 0, 1);
      // The closest ships fly in.
      ships.sort((a, b) => distSq(a.x, a.y, core.x, core.y) - distSq(b.x, b.y, core.x, core.y));
      const parts = ships.splice(0, per - 1);
      const merge: Merge = { core, parts, time: 0 };
      core.merge = merge;
      for (const p of parts) p.merge = merge;
      state.merges.push(merge);
      addSound(state, 'sfx.merge', core, core.tier); // deeper for bigger merges
    }
  }
}

function updateMerges(state: GameState, dt: number) {
  for (const m of state.merges) {
    m.time += dt;
    const core = m.core;
    for (const p of m.parts) {
      if (p.absorbed) {
        // Ride along inside the core (hidden) until the merge finishes.
        p.x = core.x;
        p.y = core.y;
        p.vx = p.vy = 0;
        continue;
      }
      // Fly into the core, faster the further away it is.
      const t = typeOf(p);
      const dx = core.x - p.x;
      const dy = core.y - p.y;
      if (Math.hypot(dx, dy) < core.stats.radius * 0.5) {
        p.absorbed = true;
        continue;
      }
      steer(p, core.vx + dx * 4, core.vy + dy * 4, t.accel * 4, dt);
      p.thrust = 'boost';
      p.angle = turnToward(p.angle, Math.atan2(dy, dx), p.stats.turnRate * dt);
    }
  }
  const done = state.merges.filter((m) => m.time >= CONFIG.tiers.mergeDuration || m.parts.every((p) => p.absorbed));
  for (const m of done) finishMerge(state, m);
  state.merges = state.merges.filter((m) => !done.includes(m));
}

/** Remove the merged ships and grow the core one tier, at full health. */
function finishMerge(state: GameState, m: Merge) {
  const core = m.core;
  const gone = new Set(m.parts);
  core.fleet.members = core.fleet.members.filter((s) => !gone.has(s));
  state.ships = state.ships.filter((s) => !gone.has(s));
  core.tier++;
  core.stats = shipStats(state, core.type, core.team, core.tier);
  core.hp = core.stats.maxHp;
  core.merge = null;
  addEffect(state, 'vfx.merge', core.x, core.y, 0, core.tier);
  // Bonus: a ring of shots in every direction, each as strong as the new ship's normal shot.
  const n = CONFIG.tiers.mergeBurstShots;
  for (let i = 0; i < n; i++) {
    const a = core.angle + (i / n) * Math.PI * 2;
    addBullet(state, core, core.x + Math.cos(a) * core.stats.radius, core.y + Math.sin(a) * core.stats.radius, a, 'merge');
  }
  if (n > 0) addSound(state, core.team === 'enemy' ? 'sfx.shoot.enemy' : 'sfx.shoot', core, core.tier);
}

// ---------- Wrecks ----------

function updateWrecks(state: GameState, dt: number) {
  for (const w of state.wrecks) {
    // Find the closest ship in your fleet.
    let nearest: Ship | null = null;
    let nearestD = Infinity;
    for (const s of state.playerFleet.members) {
      const d = distSq(s.x, s.y, w.x, w.y);
      if (d < nearestD) {
        nearestD = d;
        nearest = s;
      }
    }
    const r = statsFor(w.type, 'enemy', w.tier).radius;
    const magnetR = CONFIG.wreckMagnetRange + r;
    if (nearest && nearestD < magnetR * magnetR) {
      // Close enough: the wreck drifts toward that ship.
      const d = Math.sqrt(nearestD) || 1;
      w.vx += ((nearest.x - w.x) / d) * CONFIG.wreckMagnetAccel * dt;
      w.vy += ((nearest.y - w.y) / d) * CONFIG.wreckMagnetAccel * dt;
    } else {
      // Otherwise it slowly comes to a stop.
      w.vx = approach(w.vx, 0, 10 * dt);
      w.vy = approach(w.vy, 0, 10 * dt);
    }
    w.x += w.vx * dt;
    w.y += w.vy * dt;
    w.angle += w.spin * dt;
    w.life -= dt;
    // Any ship in your fleet that touches a wreck recruits it, at the wreck's tier.
    for (const s of state.playerFleet.members) {
      const reach = r + s.stats.radius;
      if (distSq(s.x, s.y, w.x, w.y) < reach * reach) {
        const ship = addShip(state, 'player', w.type, w.tier, state.playerFleet, w.x, w.y, w.angle);
        ship.vx = s.vx;
        ship.vy = s.vy;
        addEffect(state, 'vfx.recruit', w.x, w.y, 0, w.tier);
        addSound(state, 'sfx.recruit', w, w.tier);
        w.life = 0;
        break;
      }
    }
  }
  state.wrecks = state.wrecks.filter((w) => w.life > 0);
}

// ---------- Enemy waves ----------

function updateWaves(state: GameState, dt: number, spawnDistance: number) {
  state.waveTimer -= dt;
  if (state.waveTimer > 0) return;
  state.wave++;
  // Each wave comes a little sooner than the last, with a random swing either way.
  const base = CONFIG.waveInterval * CONFIG.waveIntervalShrink ** (state.wave - 1);
  const swing = randRange(1 - CONFIG.waveIntervalRandom, 1 + CONFIG.waveIntervalRandom);
  state.waveTimer = Math.max(CONFIG.waveIntervalMin, base * swing);
  state.history.push({ time: state.survived, wave: state.wave, value: fleetValue(state.playerFleet) });
  const center = controlledShip(state);
  if (!center) return;

  const room = CONFIG.maxEnemies - state.ships.filter((s) => s.team === 'enemy').length;
  const first = CONFIG.enemyFleetsFromWave;
  const fleetWave = state.wave >= first && (state.wave - first) % CONFIG.enemyFleetEveryNthWave === 0;

  // Every few waves an elite comes. If this wave already brings a fleet, it waits for the next one.
  const E = CONFIG.elite;
  if ((state.elitesEnabled || CONFIG.swarm.enabled) && state.wave >= E.firstWave && state.wave % E.everyNthWave === 0) state.eliteDue = true;
  // Sometimes a swarm comes instead of the elite.
  if (state.eliteDue && !fleetWave) {
    state.eliteDue = false;
    if (CONFIG.swarm.enabled && Math.random() < CONFIG.swarm.chance) spawnSwarm(state, center, spawnDistance, room);
    else if (state.elitesEnabled) spawnElite(state, center, spawnDistance);
  }

  if (fleetWave) {
    // One enemy fleet in formation. It grows with the wave number (see curves.ts), not with your fleet.
    spawnEnemyFleet(state, center, spawnDistance, waveFleetValue(state.wave), room);
    addSound(state, 'sfx.alert', center, 1, 1, true);
  } else {
    // A handful of lone fighters from random directions (a few more in the first waves).
    const base = 1 + Math.floor(state.wave * CONFIG.loneEnemiesPerWave);
    const early = state.wave <= CONFIG.earlyWavesUntil ? 1 + CONFIG.earlyWaveExtraEnemies : 1;
    // Late waves bring more (and allow more).
    const late = lateWaveMultiplier(state.wave);
    const count = Math.min(Math.round(base * early * late), Math.round(CONFIG.maxLoneEnemiesPerWave * late), room);
    for (let i = 0; i < count; i++) spawnEnemyFleet(state, center, spawnDistance, 1, room);
  }
}

/** Spawn an enemy fleet worth `value`, made of tiers by the same rule as yours. */
function spawnEnemyFleet(state: GameState, near: Ship, distance: number, value: number, room: number) {
  const counts = tierCounts(value);
  // Never go over the enemy limit: drop small ships first.
  let total = counts.reduce((a, b) => a + b, 0);
  for (let t = 0; t < counts.length && total > room; t++) {
    const drop = Math.min(counts[t], total - room);
    counts[t] -= drop;
    total -= drop;
  }
  if (total <= 0) return;
  const a = Math.random() * Math.PI * 2;
  const facing = a + Math.PI;
  const fleet = newFleet('enemy');
  // Biggest ships first, so the biggest one leads.
  for (let t = counts.length - 1; t >= 0; t--)
    for (let i = 0; i < counts[t]; i++) addShip(state, 'enemy', 'fighter', t + 1, fleet, 0, 0, facing);
  const [leader, ...rest] = fleet.members;
  fleet.leader = leader;
  if (rest.length) for (const m of fleet.members) m.inFleet = true;
  // Big fleets start further out, so they don't appear on screen.
  const followers = formationOrder(rest);
  const slots = formationSlots(leader, followers);
  const extent = Math.max(0, ...slots.map((s) => Math.hypot(s.x, s.y)));
  const x = near.x + Math.cos(a) * (distance + extent);
  const y = near.y + Math.sin(a) * (distance + extent);
  leader.x = x;
  leader.y = y;
  followers.forEach((s, i) => {
    s.x = x + slots[i].x;
    s.y = y + slots[i].y;
  });
  state.enemyFleets.push(fleet);
}

/**
 * Spawn an elite: one strong enemy that uses skills. Its tier is the biggest
 * tier an enemy fleet of this wave would have (plus CONFIG.elite.extraTiers).
 */
function spawnElite(state: GameState, near: Ship, distance: number) {
  const E = CONFIG.elite;
  const counts = tierCounts(waveFleetValue(state.wave));
  let top = 1;
  counts.forEach((n, i) => {
    if (n > 0) top = i + 1;
  });
  const a = Math.random() * Math.PI * 2;
  const fleet = newFleet('enemy');
  const ship = addShip(state, 'enemy', 'fighter', top + E.extraTiers, fleet, 0, 0, a + Math.PI);
  // Health follows the wave's enemy fleet value (smooth), with some randomness.
  const normal = ship.stats.maxHp;
  const tier1 = statsFor('fighter', 'enemy', 1).maxHp;
  const random = randRange(1 - E.healthRandom, 1 + E.healthRandom);
  ship.stats.maxHp = Math.max(1, Math.round(tier1 * E.healthPerFleetValue * waveFleetValue(state.wave) * random * enemyHealthMultiplier(state.wave)));
  ship.hp = ship.stats.maxHp;
  ship.elite = { skills: makeEliteSkills(state.elitesSpawned), laserCharge: 0, healthScale: ship.stats.maxHp / normal };
  ship.x = near.x + Math.cos(a) * (distance + ship.stats.radius);
  ship.y = near.y + Math.sin(a) * (distance + ship.stats.radius);
  fleet.leader = ship;
  state.enemyFleets.push(fleet);
  state.elitesSpawned++;
  // A new warning lists this elite's skills; elites arriving during the same warning are added to it.
  const showing = state.time - state.eliteAlertTime < eliteAlertTime(state);
  state.eliteAlertSkills = [...(showing ? state.eliteAlertSkills : []), ship.elite.skills.map((sk) => sk.id)];
  state.eliteAlertTime = state.time;
  addSound(state, 'sfx.alert', near, 1, 1, true);
}

/**
 * Spawn a swarm wave: many small ships (at least CONFIG.swarm.tiersBelow tiers
 * below your biggest ship, never below tier 1), in chevrons spread over a wide
 * arc on one side. Every chevron curves in toward you, turning the same way.
 */
function spawnSwarm(state: GameState, near: Ship, distance: number, room: number) {
  const S = CONFIG.swarm;
  const total = Math.min(Math.round(S.count + S.countPerWave * state.wave), S.maxCount, room);
  if (total <= 0) return;
  const top = Math.max(1, state.maxTier - S.tiersBelow);
  const smaller = top > 1 ? Math.round(total * S.smallerShare) : 0;
  const chevrons = Math.max(1, Math.round(total / S.shipsPerChevron));
  const approachAngle = Math.random() * Math.PI * 2;
  const arc = (S.arc * Math.PI) / 180;
  const turn = Math.random() < 0.5 ? 1 : -1;
  // Share the ships out so every chevron gets a mix of both sizes.
  const groups: number[][] = Array.from({ length: chevrons }, () => []);
  for (let i = 0; i < total; i++) groups[i % chevrons].push(i < total - smaller ? top : top - 1);
  groups.forEach((tiers, g) => {
    const a = approachAngle + (chevrons === 1 ? 0 : (g / (chevrons - 1) - 0.5) * arc);
    spawnChevron(state, near, distance, a, tiers, turn);
  });
  state.swarmAlertTime = state.time;
  addSound(state, 'sfx.swarm', near, 1, 1, true);
}

/** One chevron of a swarm: 2–3 rows of nested V shapes, coming from angle `a`, biggest ship leading. */
function spawnChevron(state: GameState, near: Ship, distance: number, a: number, tiers: number[], turn: number) {
  const S = CONFIG.swarm;
  const facing = a + Math.PI;
  const fleet = newFleet('enemy');
  const ships = [...tiers].sort((x, y) => y - x).map((t) => addShip(state, 'enemy', 'fighter', t, fleet, 0, 0, facing));
  const [leader, ...rest] = ships;
  fleet.leader = leader;
  const spacing = CONFIG.formationSpacing * S.spacing * leader.stats.size;
  // Spots in the leader's own frame (x forward, y sideways). Each row is a V: its
  // tip, then pairs going back along both arms. Row 0's tip is the leader.
  const rows = Math.floor(randRange(S.minRows, S.maxRows + 1));
  const perRow = Math.ceil(ships.length / rows);
  const spots: { x: number; y: number; row: number }[] = [];
  for (let row = 0; row < rows; row++)
    for (let j = row === 0 ? 1 : 0; j < perRow; j++) {
      const arm = Math.ceil(j / 2);
      const side = j % 2 ? 1 : -1;
      spots.push({ x: -row * spacing * 1.2 - arm * spacing * 0.8, y: arm === 0 ? 0 : side * arm * spacing, row });
    }
  const slots = new Map<number, { x: number; y: number; row: number }>();
  rest.forEach((s, i) => slots.set(s.id, spots[i]));
  const extent = Math.max(0, ...spots.map((p) => Math.hypot(p.x, p.y)));
  const from = distance + extent;
  fleet.swarm = { turn, from, slots };
  const c = Math.cos(facing);
  const sn = Math.sin(facing);
  leader.x = near.x + Math.cos(a) * from;
  leader.y = near.y + Math.sin(a) * from;
  for (const s of rest) {
    const p = slots.get(s.id)!;
    s.x = leader.x + p.x * c - p.y * sn;
    s.y = leader.y + p.x * sn + p.y * c;
  }
  state.enemyFleets.push(fleet);
}

// ---------- Test tools (only reachable from dev-mode keys) ----------

/** Spawns a swarm wave right away. */
export function testSpawnSwarm(state: GameState, spawnDistance: number) {
  const center = controlledShip(state);
  const room = CONFIG.maxEnemies - state.ships.filter((s) => s.team === 'enemy').length;
  if (center) spawnSwarm(state, center, spawnDistance, room);
}

/** Adds tier-1 ships to your fleet right next to the flagship. */
export function testAddShips(state: GameState, count: number) {
  const leader = controlledShip(state);
  if (!leader) return;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const x = leader.x + Math.cos(a) * (50 + leader.stats.radius);
    const y = leader.y + Math.sin(a) * (50 + leader.stats.radius);
    addShip(state, 'player', leader.type, 1, state.playerFleet, x, y, leader.angle);
    addEffect(state, 'vfx.recruit', x, y);
  }
}

/**
 * Adds one ship of the next tier up (one above your biggest) next to the
 * flagship. You move into it at once, as after a merge (promoteFlagship).
 */
export function testAddNextTier(state: GameState) {
  const leader = controlledShip(state);
  if (!leader) return;
  const tier = Math.max(...state.playerFleet.members.map((s) => s.tier)) + 1;
  const a = Math.random() * Math.PI * 2;
  const x = leader.x + Math.cos(a) * leader.stats.radius * 3;
  const y = leader.y + Math.sin(a) * leader.stats.radius * 3;
  addShip(state, 'player', leader.type, tier, state.playerFleet, x, y, leader.angle);
  addEffect(state, 'vfx.recruit', x, y, 0, tier);
}

/** Destroys one of your smallest ships (never the one you're flying or a merging one). */
export function testRemoveShip(state: GameState) {
  const leader = controlledShip(state);
  const candidates = state.playerFleet.members.filter((s) => s !== leader && !s.merge);
  const victim = formationOrder(candidates).pop();
  if (victim) victim.dead = true;
}

/** Destroys your whole fleet (to test the end-of-run screen). */
export function testDestroyFleet(state: GameState) {
  for (const s of state.playerFleet.members) s.dead = true;
}

/** Spawns an elite right away (even if elites are turned off). */
export function testSpawnElite(state: GameState, spawnDistance: number) {
  const center = controlledShip(state);
  if (center) spawnElite(state, center, spawnDistance);
}

/** Destroys every enemy inside the given area (they can still leave wrecks). */
export function testKillEnemies(state: GameState, view: { x: number; y: number; w: number; h: number }) {
  for (const s of state.ships)
    if (s.team === 'enemy' && s.x >= view.x && s.x <= view.x + view.w && s.y >= view.y && s.y <= view.y + view.h)
      s.dead = true;
}

// ---------- Effects and sounds ----------

export function addSound(state: GameState, name: string, at: { x: number; y: number }, tier = 1, volume = 1, global = false) {
  state.sounds.push({ name, tier, x: at.x, y: at.y, volume, global });
}

export function addEffect(state: GameState, sprite: string, x: number, y: number, angle = 0, tier = 1, scale = 1) {
  const e: Effect = { sprite, tier, x, y, angle, age: 0, scale };
  state.effects.push(e);
  return e;
}

/**
 * The ship you fly is destroyed: a big explosion, a screen shake, and spinning hull
 * debris thrown out from it that carries on with the ship's own movement (CONFIG.death).
 */
function flagshipExplosion(state: GameState, s: Ship) {
  const D = CONFIG.death;
  addEffect(state, 'vfx.flagship-explosion', s.x, s.y, Math.random() * Math.PI * 2, s.tier);
  addSound(state, 'sfx.flagship-explosion', s, s.tier, 1, true);
  state.shake = { time: D.shakeTime, strength: D.shake };
  const size = s.stats.size;
  const count = D.debrisCount + D.debrisPerTier * (s.tier - 1);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const burst = randRange(D.debrisBurstMin, D.debrisBurstMax) * size;
    const r = Math.random() * s.stats.radius * 0.6;
    state.debris.push({
      team: s.team,
      piece: i,
      x: s.x + Math.cos(a) * r,
      y: s.y + Math.sin(a) * r,
      vx: s.vx * D.debrisMomentum + Math.cos(a) * burst,
      vy: s.vy * D.debrisMomentum + Math.sin(a) * burst,
      angle: Math.random() * Math.PI * 2,
      spin: randRange(-D.debrisSpin, D.debrisSpin),
      age: 0,
      life: randRange(D.debrisLifeMin, D.debrisLifeMax),
      scale: size * randRange(0.7, 1.1),
    });
  }
}

/** Debris drifts, spins and slows down; the screen shake fades. */
function updateDebris(state: GameState, dt: number) {
  const k = Math.exp(-CONFIG.death.debrisDrag * dt);
  for (const d of state.debris) {
    d.age += dt;
    d.vx *= k;
    d.vy *= k;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.angle += d.spin * dt;
  }
  state.debris = state.debris.filter((d) => d.age < d.life);
  state.shake.time = Math.max(0, state.shake.time - dt);
}

function updateEffects(state: GameState, dt: number) {
  for (const e of state.effects) e.age += dt;
  state.effects = state.effects.filter((e) => e.age < state.effectDuration(e.sprite, e.tier));
}
