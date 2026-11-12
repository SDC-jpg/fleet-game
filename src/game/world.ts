// The game rules: ships, fleets, tiers and merging, shooting, wrecks, enemy waves.
// No drawing happens here, only updating numbers.

import { approach, clamp, distSq, randRange, turnToward, wrapAngle } from '../engine/math';
import { CLASS_IDS, CONFIG, SHIP_TYPES, type ClassId, type ComboId, type ShipType, type ShipTypeId } from './config';
import {
  addModules,
  allRare,
  computeBuild,
  noModules,
  sampleModules,
  hitShip,
  oneModule,
  randomClass,
  randomEnemyModules,
  startingTimers,
  steerMissile,
  updateAbilities,
  type Build,
  type Modules,
} from './abilities';

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
  /** 1 = basic ship. CONFIG.tiers.shipsPerMerge ships of one tier merge into 1 of the next. */
  tier: number;
  stats: ShipStats;
  /** How many tier-1 ships of each class went into this ship. */
  modules: Modules;
  /** How many of those modules are rare (stronger abilities). */
  rare: Modules;
  /** Elite enemy: tougher, glowing, all modules rare, always leaves a wreck. */
  elite: boolean;
  /** Combo chosen at the body shop (used while it still qualifies). */
  comboChoice: ComboId | null;
  /** What the modules add up to: abilities, their strength, combo (see abilities.ts). */
  build: Build;
  /** Seconds until each ability can be used again. */
  abilityTimers: Modules;
  /** Each ability's full cooldown when it was last used (for the refilling icons). */
  abilityCooldowns: Modules;
  /** Damage an Aegis shield will still absorb, and seconds until it fades. */
  shield: number;
  shieldTime: number;
  /** Combo of the Knight that gave this shield (Mirror Guard or Retaliation), if any. */
  shieldCombo: ComboId | null;
  /** Seconds until this ship's shield can fire another Retaliation missile. */
  retaliationTimer: number;
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
  /** Personal randomness so ships in a formation don't move in perfect sync. */
  quirk: { phaseX: number; phaseY: number; speedX: number; speedY: number; delay: number };
}

/** Several ships flying into one (the core), which then becomes one tier bigger. */
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
});

export interface Bullet {
  team: Team;
  /** A normal shot, a Lance (passes through ships) or a homing missile. */
  kind: 'shot' | 'lance' | 'missile';
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
  /** For shots that pass through ships: ids of the ships already hit (each is hit once). null = stops at the first hit. */
  pierce: number[] | null;
  /** Missiles: how fast they turn toward `target` (0 = fly straight). */
  homing: number;
  target: Ship | null;
  /** Splinter Volley combo: bursts into small lances on impact. */
  splinter: boolean;
}

export interface Wreck {
  type: ShipTypeId;
  tier: number;
  /** The destroyed ship's modules (and how many are rare), passed on to the ship you recruit. */
  modules: Modules;
  rare: Modules;
  /** Its build, to show its class icons. */
  build: Build;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  life: number;
}

/** The body shop station: sits still until you fly in, or until it leaves. */
export interface Shop {
  x: number;
  y: number;
  /** Seconds before it leaves. */
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
export interface Effect {
  sprite: string;
  /** Picks a bigger version of the effect for bigger ships, if the art exists. */
  tier: number;
  x: number;
  y: number;
  angle: number;
  age: number;
}

/** Ships destroyed on each side this run (merged ships don't count as losses). */
export interface RunStats {
  kills: number;
  /** What the destroyed enemies were worth, in tier-1 ships. */
  killValue: number;
  losses: number;
  lossValue: number;
}

/** Fleet value at one moment (one point per wave, for the end-of-run graph). */
export interface HistoryPoint {
  time: number;
  wave: number;
  value: number;
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
  merges: Merge[];
  /** Sounds announced this step. Game.ts plays and clears them. */
  sounds: SoundEvent[];
  playerFleet: Fleet;
  enemyFleets: Fleet[];
  wave: number;
  waveTimer: number;
  /** Seconds until you can dash again (0 = ready). */
  dashCooldown: number;
  /** Currency for the body shop, earned from kills. */
  scrap: number;
  /** The body shop station, while one is visiting. */
  shop: Shop | null;
  /** True while you're inside the body shop (the game is paused meanwhile). */
  shopOpen: boolean;
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
  /** Flagship ability pressed this step (right-click). */
  ability: boolean;
  /** Mouse wheel: switch to the next (1) or previous (-1) of your biggest ships, or 0. */
  switchShip: number;
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
    merges: [],
    sounds: [],
    playerFleet: newFleet('player'),
    enemyFleets: [],
    wave: 0,
    waveTimer: CONFIG.firstWaveDelay,
    dashCooldown: 0,
    scrap: 0,
    shop: null,
    shopOpen: false,
    boostStamina: 1,
    boostLocked: false,
    boostRest: 0,
    stats: { kills: 0, killValue: 0, losses: 0, lossValue: 0 },
    history: [{ time: 0, wave: 0, value: 1 }],
    maxFleetSize: 1,
    maxTier: 1,
    zoom: CONFIG.zoomSteps[0].zoom,
    gameOver: false,
    invincible: false,
    nextId: 1,
    effectDuration,
  };
  // You start with a Lancer.
  const flagship = addShip(state, 'player', 'fighter', 1, state.playerFleet, 0, 0, -Math.PI / 2, oneModule('lancer'));
  state.playerFleet.leader = flagship;
  return state;
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
  modules: Modules,
  rare: Modules = noModules(),
  elite = false,
) {
  const build = computeBuild(modules, rare, tier);
  const stats = shipStats(type, team, tier, build, elite);
  const timers = startingTimers();
  const ship: Ship = {
    id: state.nextId++,
    team,
    type,
    tier,
    stats,
    modules,
    rare,
    elite,
    comboChoice: null,
    build,
    abilityTimers: timers,
    abilityCooldowns: { ...timers },
    shield: 0,
    shieldTime: 0,
    shieldCombo: null,
    retaliationTimer: 0,
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

/** A ship's stats with its build applied (small class shares strengthen the basic gun), and elite bonuses. */
function shipStats(type: ShipTypeId, team: Team, tier: number, build: Build, elite = false) {
  const stats = statsFor(type, team, tier);
  stats.bulletDamage *= build.gunBonus;
  if (elite) {
    stats.maxHp = Math.round(stats.maxHp * CONFIG.elites.hpMultiplier);
    stats.bulletDamage *= CONFIG.elites.damageMultiplier;
  }
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
  if (state.gameOver) return;
  state.survived += dt;
  state.dashCooldown = Math.max(0, state.dashCooldown - dt);
  for (const f of [state.playerFleet, ...state.enemyFleets]) f.dashTime = Math.max(0, f.dashTime - dt);

  if (controls.switchShip) switchFlagship(state, controls.switchShip);
  updatePlayerLeader(state, controls, dt);
  for (const fleet of [state.playerFleet, ...state.enemyFleets]) updateFleet(state, fleet, dt);
  updateAbilities(state, controls.ability, dt);
  updateMerges(state, dt);
  separateShips(state, dt);

  for (const s of state.ships) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.fireTimer -= dt;
  }

  updateBullets(state, dt);
  removeDeadShips(state);
  updateWrecks(state, dt);
  updateShop(state, dt);
  startMerges(state);
  promoteFlagship(state);
  updateWaves(state, dt, spawnDistance);

  const fleet = state.playerFleet;
  state.maxFleetSize = Math.max(state.maxFleetSize, fleetValue(fleet));
  for (const s of fleet.members) state.maxTier = Math.max(state.maxTier, s.tier);
  // Zoom follows the biggest fleet/tier you've had, so it doesn't jump back and forth in a fight.
  let zoom = Infinity;
  for (const step of CONFIG.zoomSteps) {
    const reached = state.maxFleetSize >= (step.minFleet ?? 0) && state.maxTier >= (step.minTier ?? 0);
    if (reached) zoom = Math.min(zoom, step.zoom);
  }
  state.zoom = zoom;
  if (fleet.members.length === 0) {
    state.gameOver = true;
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
  if (!ship) return;
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
  const boosting = useBoostStamina(state, ship, c.boost && len > 0, dt);
  const mul = Math.max(boosting ? t.boostMultiplier : 1, dashMultiplier(fleet));
  const speed = t.maxSpeed * mul * directionFactor(ship.angle, mx, my);
  steer(ship, mx * speed, my * speed, t.accel * mul, dt);
  if (boosting && ship.thrust !== 'boost') addSound(state, 'sfx.boost', ship, ship.tier);
  ship.thrust = boosting || fleet.dashTime > 0 ? 'boost' : steering ? 'move' : 'idle';
  ship.angle = turnToward(ship.angle, Math.atan2(c.aimY - ship.y, c.aimX - ship.x), ship.stats.turnRate * dt);
  if (c.fire && ship.fireTimer <= 0 && !ship.merge) fire(state, ship, ship.stats.fireCooldown, 0);
}

/**
 * Shift boost drains stamina while held and refills after a short rest. Running
 * dry locks boost until the bar is partly refilled, so it doesn't stutter on and off.
 * Returns whether the ship boosts this step.
 */
function useBoostStamina(state: GameState, ship: Ship, wants: boolean, dt: number) {
  const b = CONFIG.boost;
  if (wants && !state.boostLocked && state.boostStamina > 0) {
    // Bigger ships have more boost time.
    const duration = b.duration * b.durationPerTier ** (ship.tier - 1);
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
  const speed = typeOf(leader).maxSpeed * directionFactor(leader.angle, mx, my) * fleet.dashPower;
  fleet.dashTime = d.duration;
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
  for (const other of state.ships) {
    if (other.team === ship.team || other.dead || other.merge) continue;
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
  const slots = formationSlots(leader, followers);
  followers.forEach((ship, i) => {
    const t = typeOf(ship);
    const q = ship.quirk;
    const speedMul = ship.team === 'enemy' ? CONFIG.enemySpeedMultiplier : 1;
    const off = slots[i];
    // React to where the leader was a moment ago. Outer rings react later,
    // so turns ripple outward through the formation.
    // During a dash everyone follows the leader with no delay, so the formation stays together.
    const dashing = fleet.dashTime > 0;
    const delay = dashing ? 0 : CONFIG.followDelay + (off.ring - 1) * CONFIG.followDelayPerRing + q.delay;
    const past = trailAt(fleet, delay, dt);
    // Each ship drifts gently around its spot in its own slow loop.
    const driftX = Math.sin(state.time * q.speedX * Math.PI * 2 + q.phaseX) * CONFIG.driftAmount;
    const driftY = Math.sin(state.time * q.speedY * Math.PI * 2 + q.phaseY) * CONFIG.driftAmount;
    // Fly toward the spot, matching the (delayed) leader's speed.
    const tx = past.x + off.x + driftX - ship.x;
    const ty = past.y + off.y + driftY - ship.y;
    let wantVx = past.vx + tx * CONFIG.followStiffness;
    let wantVy = past.vy + ty * CONFIG.followStiffness;
    const wantLen = Math.hypot(wantVx, wantVy);
    // When the leader boosts, the whole formation boosts to keep up.
    const boosting = past.boosting || dashing;
    const boostMul = Math.max(past.boosting ? t.boostMultiplier : 1, dashMultiplier(fleet));
    const maxV = t.maxSpeed * speedMul * 1.5 * boostMul;
    if (wantLen > maxV) {
      wantVx *= maxV / wantLen;
      wantVy *= maxV / wantLen;
    }
    steer(ship, wantVx, wantVy, t.accel * boostMul, dt);
    const moving = Math.hypot(ship.vx, ship.vy) > MOVING_SPEED;
    ship.thrust = !moving ? 'idle' : boosting ? 'boost' : 'move';
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
  ship.fireTimer = cooldown;
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
function addBullet(state: GameState, ship: Ship, x: number, y: number, angle: number) {
  const st = ship.stats;
  spawnBullet(state, {
    team: ship.team,
    kind: 'shot',
    sprite: typeOf(ship).sprites.bullet,
    tier: ship.tier,
    x,
    y,
    vx: Math.cos(angle) * st.bulletSpeed,
    vy: Math.sin(angle) * st.bulletSpeed,
    life: st.bulletLife,
    damage: st.bulletDamage,
    radius: st.bulletRadius,
  });
}

/** Add any kind of shot. Fields left out are a plain shot's (stops at the first hit, flies straight). */
export function spawnBullet(
  state: GameState,
  b: Omit<Bullet, 'pierce' | 'homing' | 'target' | 'splinter'> & Partial<Bullet>,
) {
  state.bullets.push({ pierce: null, homing: 0, target: null, splinter: false, ...b });
}

function updateBullets(state: GameState, dt: number) {
  // New shots (splinters, reflections) made during this loop move from the next step.
  for (const b of [...state.bullets]) {
    if (b.life <= 0) continue;
    if (b.homing > 0) steerMissile(state, b, dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // A Lance leaves a glowing trail that lingers a moment, so you can see where it went.
    if (b.sprite === 'projectile.lance') {
      const a = Math.atan2(b.vy, b.vx);
      const half = (Math.hypot(b.vx, b.vy) * dt) / 2;
      addEffect(state, 'vfx.lance-trail', b.x - Math.cos(a) * half, b.y - Math.sin(a) * half, a, b.tier);
    }
    b.life -= dt;
    for (const s of state.ships) {
      // Merging ships can't be hit: shots pass through.
      if (s.team === b.team || s.dead || s.merge) continue;
      if (b.pierce?.includes(s.id)) continue;
      const r = s.stats.radius + b.radius;
      if (distSq(b.x, b.y, s.x, s.y) > r * r) continue;
      hitShip(state, s, b);
      // A Lance's hits spark one size bigger, so they stand out.
      addEffect(state, 'vfx.hit', b.x, b.y, 0, b.kind === 'lance' ? b.tier + 1 : b.tier);
      addSound(state, 'sfx.hit', b, b.tier);
      // A Lance keeps going through every ship in its path.
      if (b.pierce) {
        b.pierce.push(s.id);
        continue;
      }
      b.life = 0;
      break;
    }
  }
  state.bullets = state.bullets.filter((b) => b.life > 0);
}

function removeDeadShips(state: GameState) {
  for (const s of state.ships) {
    if (!s.dead) continue;
    addEffect(state, 'vfx.explosion', s.x, s.y, Math.random() * Math.PI * 2, s.tier);
    addSound(state, 'sfx.explosion', s, s.tier);
    if (s.team === 'enemy') {
      state.stats.kills++;
      state.stats.killValue += tierValue(s.tier);
      state.scrap += tierValue(s.tier) * CONFIG.scrap.perKillValue + (s.elite ? CONFIG.scrap.eliteBonus : 0);
      dropWrecks(state, s);
    } else {
      state.stats.losses++;
      state.stats.lossValue += tierValue(s.tier);
    }
    const fleet = s.fleet;
    fleet.members = fleet.members.filter((m) => m !== s);
    if (fleet.leader === s) {
      fleet.leader = pickNewLeader(fleet, s);
      if (fleet === state.playerFleet && fleet.leader) addSound(state, 'sfx.command', s, 1, 1, true);
    }
  }
  state.ships = state.ships.filter((s) => !s.dead);
  state.enemyFleets = state.enemyFleets.filter((f) => f.members.length > 0);
}

/**
 * What a destroyed enemy leaves behind:
 * - Maybe a whole wreck of its tier (less likely for bigger ships; always for
 *   your first kill and for elites).
 * - Big ships (tier 2+) also drop some of their modules as tier-1 wrecks.
 * Elites' modules are all rare. Ordinary tier-1 wrecks are sometimes rare.
 */
function dropWrecks(state: GameState, s: Ship) {
  const T = CONFIG.tiers;
  const first = state.stats.kills === 1 && CONFIG.firstKillWreck;
  let chance = CONFIG.wreckChance * T.wreckChancePerTier ** (s.tier - 1);
  if (s.tier > 1) chance *= CONFIG.moduleDrops.bigWreckChanceMultiplier;
  if (first || s.elite || Math.random() < chance) {
    const luckyRare = s.tier === 1 && Math.random() < CONFIG.rare.wreckChance;
    addWreck(state, s, s.tier, { ...s.modules }, luckyRare ? allRare(s.modules) : { ...s.rare }, 0, 0);
  }
  if (s.tier === 1) return;
  const D = CONFIG.moduleDrops;
  const total = CLASS_IDS.reduce((sum, c) => sum + s.modules[c], 0);
  const count = Math.min(D.max, Math.max(1, Math.round(total * D.share)));
  for (const [c, isRare] of sampleModules(s.modules, s.rare, count)) {
    const rare = isRare || Math.random() < CONFIG.rare.wreckChance;
    // Scatter them around where the ship was.
    const a = Math.random() * Math.PI * 2;
    const speed = randRange(40, 110);
    addWreck(state, s, 1, oneModule(c), rare ? oneModule(c) : noModules(), Math.cos(a) * speed, Math.sin(a) * speed);
  }
}

function addWreck(state: GameState, s: Ship, tier: number, modules: Modules, rare: Modules, vx: number, vy: number) {
  state.wrecks.push({
    type: s.type,
    tier,
    modules,
    rare,
    build: computeBuild(modules, rare, tier),
    x: s.x,
    y: s.y,
    vx: s.vx * 0.3 + vx,
    vy: s.vy * 0.3 + vy,
    angle: s.angle,
    spin: randRange(-1, 1) / 1.5 ** (tier - 1),
    life: CONFIG.wreckLifetime,
  });
}

/**
 * Work a ship's build and stats out again after its modules changed (body shop).
 * Ties between classes keep their old order, and a chosen combo stays if it still qualifies.
 */
export function refreshShip(ship: Ship) {
  ship.build = computeBuild(ship.modules, ship.rare, ship.tier, {
    order: [ship.build.main, ...ship.build.abilities],
    combo: ship.comboChoice,
  });
  ship.stats = shipStats(ship.type, ship.team, ship.tier, ship.build, ship.elite);
  ship.hp = Math.min(ship.hp, ship.stats.maxHp);
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

/**
 * The ships the mouse wheel switches between, in order: your highest-tier ships.
 * At tier 1 that's one per class (Lancer, Knight, Ballista), the least damaged
 * of each, plus the ship you fly for its own class.
 */
export function switchOptions(state: GameState): Ship[] {
  const fleet = state.playerFleet;
  const free = fleet.members.filter((s) => !s.merge);
  const top = Math.max(0, ...free.map((s) => s.tier));
  const options = free.filter((s) => s.tier === top).sort((a, b) => a.id - b.id);
  if (top !== 1) return options;
  const health = (s: Ship) => s.hp / s.stats.maxHp;
  const picks: Ship[] = [];
  for (const c of CLASS_IDS) {
    const ofClass = options.filter((s) => s.build.main === c);
    if (!ofClass.length) continue;
    const current = ofClass.find((s) => s === fleet.leader);
    picks.push(current ?? ofClass.reduce((best, s) => (health(s) > health(best) ? s : best)));
  }
  return picks;
}

/**
 * Mouse wheel: fly the next (dir 1) or previous (-1) ship from switchOptions,
 * so you choose whose ability is on right-click.
 */
function switchFlagship(state: GameState, dir: number) {
  const fleet = state.playerFleet;
  const options = switchOptions(state);
  if (options.length < 2 || !fleet.leader || fleet.leader.merge) return;
  const i = options.indexOf(fleet.leader);
  fleet.leader = options[(i + dir + options.length) % options.length];
  addSound(state, 'sfx.command', fleet.leader, 1, 0.6, true);
}

// ---------- Merging ----------

/**
 * Once your fleet is big enough, every CONFIG.tiers.shipsPerMerge ships of the
 * same tier start merging. Like merges with like: ships of the most common class
 * go together first, and only leftovers mix.
 */
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
  for (let ships of byTier.values()) {
    while (ships.length >= per) {
      const byClass = new Map<ClassId, Ship[]>();
      for (const s of ships) byClass.set(s.build.main, [...(byClass.get(s.build.main) ?? []), s]);
      const classes = [...byClass.keys()].sort((a, b) => byClass.get(b)!.length - byClass.get(a)!.length);
      const first = byClass.get(classes[0])!;
      // The flagship is the core whenever it's in the group, so you keep flying it.
      let core = fleet.leader && first.includes(fleet.leader) ? fleet.leader : first[0];
      // Take the closest ships of the biggest class, then of the next, until there are enough.
      const picked: Ship[] = [];
      for (const c of classes) {
        const list = byClass.get(c)!.sort((a, b) => distSq(a.x, a.y, core.x, core.y) - distSq(b.x, b.y, core.x, core.y));
        picked.push(...list.slice(0, per - picked.length));
        if (picked.length === per) break;
      }
      if (fleet.leader && picked.includes(fleet.leader)) core = fleet.leader;
      ships = ships.filter((s) => !picked.includes(s));
      const parts = picked.filter((s) => s !== core);
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
  // The new ship carries every module of the ships that went into it.
  for (const p of m.parts) {
    core.modules = addModules(core.modules, p.modules);
    core.rare = addModules(core.rare, p.rare);
  }
  core.comboChoice = null;
  core.build = computeBuild(core.modules, core.rare, core.tier);
  core.stats = shipStats(core.type, core.team, core.tier, core.build);
  core.hp = core.stats.maxHp;
  core.merge = null;
  addEffect(state, 'vfx.merge', core.x, core.y, 0, core.tier);
  // Bonus: a ring of shots in every direction, each as strong as the new ship's normal shot.
  const n = CONFIG.tiers.mergeBurstShots;
  for (let i = 0; i < n; i++) {
    const a = core.angle + (i / n) * Math.PI * 2;
    addBullet(state, core, core.x + Math.cos(a) * core.stats.radius, core.y + Math.sin(a) * core.stats.radius, a);
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
        const ship = addShip(state, 'player', w.type, w.tier, state.playerFleet, w.x, w.y, w.angle, w.modules, w.rare);
        ship.vx = s.vx;
        ship.vy = s.vy;
        addEffect(state, 'vfx.recruit', w.x, w.y, 0, w.tier);
        addSound(state, 'sfx.recruit', w, w.tier);
        if (CLASS_IDS.some((c) => w.rare[c] > 0)) addSound(state, 'sfx.rare', w, 1, 1, true);
        w.life = 0;
        break;
      }
    }
  }
  state.wrecks = state.wrecks.filter((w) => w.life > 0);
}

// ---------- Body shop ----------

/** The body shop waits (and eventually leaves). Flying the ship you control into it opens it. */
function updateShop(state: GameState, dt: number) {
  const shop = state.shop;
  if (!shop) return;
  shop.life -= dt;
  if (shop.life <= 0) {
    state.shop = null;
    return;
  }
  const ship = controlledShip(state);
  if (!ship || ship.merge) return;
  const reach = CONFIG.shop.radius + ship.stats.radius;
  if (distSq(ship.x, ship.y, shop.x, shop.y) < reach * reach) {
    state.shopOpen = true;
    ship.vx = ship.vy = 0;
    addSound(state, 'sfx.shop', ship, 1, 1, true);
  }
}

/** Leave the body shop: the station departs and the game goes on. */
export function closeShop(state: GameState) {
  state.shopOpen = false;
  state.shop = null;
}

/** Test helper: a body shop appears near you right away. */
export function testSpawnShop(state: GameState) {
  const c = controlledShip(state);
  if (c) state.shop = { x: c.x + 120, y: c.y, life: CONFIG.shop.lifetime };
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

  // Every few waves the body shop visits, a little way off. If the last one is
  // still waiting, it just stays longer.
  const S = CONFIG.shop;
  if (state.wave >= S.firstWave && (state.wave - S.firstWave) % S.everyNWaves === 0) {
    if (state.shop) state.shop.life = S.lifetime;
    else {
      const a = Math.random() * Math.PI * 2;
      const d = spawnDistance * S.distance;
      state.shop = { x: center.x + Math.cos(a) * d, y: center.y + Math.sin(a) * d, life: S.lifetime };
      addSound(state, 'sfx.shop', center, 1, 1, true);
    }
  }

  const room = CONFIG.maxEnemies - state.ships.filter((s) => s.team === 'enemy').length;
  const playerValue = fleetValue(state.playerFleet);
  const fleetWave =
    playerValue >= CONFIG.enemyFleetMinPlayerSize && state.wave % CONFIG.enemyFleetEveryNthWave === 0;

  if (fleetWave) {
    // One enemy fleet in formation, worth a bit more than yours.
    const value = Math.max(3, Math.round(playerValue * CONFIG.enemyFleetSizeRatio) + 2);
    spawnEnemyFleet(state, center, spawnDistance, value, room);
    addSound(state, 'sfx.alert', center, 1, 1, true);
  } else {
    // A handful of lone fighters from random directions.
    const count = Math.min(
      1 + Math.floor(state.wave * CONFIG.loneEnemiesPerWave),
      CONFIG.maxLoneEnemiesPerWave,
      room,
    );
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
  // Biggest ships first, so the biggest one leads. From a certain wave, the
  // leader (or a lone enemy) may be an elite.
  const E = CONFIG.elites;
  let elite = state.wave >= E.fromWave && Math.random() < E.chance;
  for (let t = counts.length - 1; t >= 0; t--)
    for (let i = 0; i < counts[t]; i++) {
      // Classes are equally common. Bigger enemies are mostly one class.
      const modules = t === 0 ? oneModule(randomClass()) : randomEnemyModules(t + 1);
      addShip(state, 'enemy', 'fighter', t + 1, fleet, 0, 0, facing, modules, elite ? allRare(modules) : noModules(), elite);
      elite = false;
    }
  const [leader, ...rest] = fleet.members;
  fleet.leader = leader;
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

// ---------- Test tools (only reachable from dev-mode keys) ----------

/** Adds tier-1 ships (of a random class, or the one given) to your fleet right next to the flagship. */
export function testAddShips(state: GameState, count: number, cls?: ClassId) {
  const leader = controlledShip(state);
  if (!leader) return;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const x = leader.x + Math.cos(a) * (50 + leader.stats.radius);
    const y = leader.y + Math.sin(a) * (50 + leader.stats.radius);
    addShip(state, 'player', leader.type, 1, state.playerFleet, x, y, leader.angle, oneModule(cls ?? randomClass()));
    addEffect(state, 'vfx.recruit', x, y);
  }
}

/** Destroys one of your smallest ships (never the one you're flying or a merging one). */
export function testRemoveShip(state: GameState) {
  const leader = controlledShip(state);
  const candidates = state.playerFleet.members.filter((s) => s !== leader && !s.merge);
  const victim = formationOrder(candidates).pop();
  if (victim) victim.dead = true;
}

/** Spawns an elite enemy just off-screen (to test elites and rare drops). */
export function testSpawnElite(state: GameState, distance: number) {
  const center = controlledShip(state);
  if (!center) return;
  const before = state.ships.length;
  spawnEnemyFleet(state, center, distance, 1, 1);
  const e = state.ships[before];
  if (!e) return;
  e.elite = true;
  e.rare = allRare(e.modules);
  e.build = computeBuild(e.modules, e.rare, e.tier);
  e.stats = shipStats(e.type, e.team, e.tier, e.build, true);
  e.hp = e.stats.maxHp;
}

/** Destroys your whole fleet (to test the end-of-run screen). */
export function testDestroyFleet(state: GameState) {
  for (const s of state.playerFleet.members) s.dead = true;
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

export function addEffect(state: GameState, sprite: string, x: number, y: number, angle = 0, tier = 1) {
  state.effects.push({ sprite, tier, x, y, angle, age: 0 });
}

function updateEffects(state: GameState, dt: number) {
  for (const e of state.effects) e.age += dt;
  state.effects = state.effects.filter((e) => e.age < state.effectDuration(e.sprite, e.tier));
}
