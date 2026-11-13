// The game rules: ships, fleets, tiers and merging, shooting, wrecks, enemy waves.
// No drawing happens here, only updating numbers.

import { approach, clamp, distSq, randRange, turnToward, wrapAngle } from '../engine/math';
import { CONFIG, SHIP_TYPES, type Rarity, type ShipType, type ShipTypeId, type SkillId, type SkillStat } from './config';
import { enemyFleetValue } from './curves';
import { drawCards, gainXp } from './progress';
import { dropItem, maybeDropItem, noBonus, updateLoot, type FleetBonus, type Item, type Loot } from './equipment';
import { makeEliteSkills, updateEliteSkills, updateSkills } from './skills';

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
  /** Damage a Shield (skill) will still absorb, and seconds until it fades. */
  shield: number;
  shieldTime: number;
  /** Set for elite enemies: their skills, and the laser warning countdown. */
  elite: EliteInfo | null;
  /** Personal randomness so ships in a formation don't move in perfect sync. */
  quirk: { phaseX: number; phaseY: number; speedX: number; speedY: number; delay: number };
}

/** What makes a ship an elite enemy. */
export interface EliteInfo {
  skills: OwnedSkill[];
  /** Seconds left of the laser warning line (0 = not charging). The laser fires when it reaches 0. */
  laserCharge: number;
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

/** A skill you've picked, with its rank (1–5) and seconds until it's ready again. */
export interface OwnedSkill {
  id: SkillId;
  rank: number;
  timer: number;
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
  /** The level-up cards on offer (the game is paused while there are some). */
  cards: Card[] | null;
  /** Skills you've picked, in the order you got them. */
  skills: OwnedSkill[];
  /** Extra damage and fire rate from bonus cards (0.1 = +10%). */
  cardBonus: { damage: number; fireRate: number };
  /** All bonuses for your whole fleet, from cards and equipment (1 = none, 1.1 = +10%). See updateBonuses. */
  bonus: FleetBonus;
  /** Every item you've found (your inventory), and the ids of the ones equipped. */
  items: Item[];
  equipped: number[];
  /** Items floating in space, waiting to be picked up. */
  loot: Loot[];
  /** The last item picked up, and when (for a short message on screen). */
  found: { item: Item; time: number } | null;
  beams: Beam[];
  mines: Mine[];
  /** Whether elites come this run (CONFIG.elite.enabled, or the test key O). */
  elitesEnabled: boolean;
  /** Elites spawned so far this run (each new one gets more skills). */
  elitesSpawned: number;
  /** An elite is waiting to come (its wave brought an enemy fleet, so it comes next wave). */
  eliteDue: boolean;
  /** When the last elite arrived (for the "Elite incoming" message). */
  eliteAlertTime: number;
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
    level: 1,
    xp: 0,
    pendingLevels: 0,
    cardDelay: 0,
    cards: null,
    skills: [],
    cardBonus: { damage: 0, fireRate: 0 },
    bonus: noBonus(),
    items: [],
    equipped: [],
    loot: [],
    found: null,
    beams: [],
    mines: [],
    elitesEnabled: CONFIG.elite.enabled,
    elitesSpawned: 0,
    eliteDue: false,
    eliteAlertTime: -Infinity,
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
  const flagship = addShip(state, 'player', 'fighter', 1, state.playerFleet, 0, 0, -Math.PI / 2);
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

/** A ship's tier stats, with your fleet's health bonus (equipment) for your ships. */
function shipStats(state: GameState, type: ShipTypeId, team: Team, tier: number) {
  const stats = statsFor(type, team, tier);
  if (team === 'player') stats.maxHp = Math.round(stats.maxHp * state.bonus.health);
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

  updatePlayerLeader(state, controls, dt);
  for (const fleet of [state.playerFleet, ...state.enemyFleets]) updateFleet(state, fleet, dt);
  updateSkills(state, controls, dt);
  updateEliteSkills(state, dt);
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
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.fireTimer -= dt;
  }

  updateBullets(state, dt);
  removeDeadShips(state);
  updateWrecks(state, dt);
  updateLoot(state, dt);
  startMerges(state);
  promoteFlagship(state);
  updateWaves(state, dt, spawnDistance);
  // A level-up shows its cards after a short delay, so the kill that caused it can play out first.
  if (!state.cards && state.pendingLevels > 0) {
    state.cardDelay += dt;
    if (state.cardDelay >= CONFIG.levels.cardDelay) {
      state.cardDelay = 0;
      state.cards = drawCards(state);
    }
  }

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
  const mul = Math.max(boosting ? t.boostMultiplier * state.bonus.boostSpeed : 1, dashMultiplier(fleet));
  const speed = t.maxSpeed * state.bonus.speed * mul * directionFactor(ship.angle, mx, my);
  steer(ship, mx * speed, my * speed, t.accel * mul, dt);
  if (boosting && ship.thrust !== 'boost') addSound(state, 'sfx.boost', ship, ship.tier);
  ship.thrust = boosting || fleet.dashTime > 0 ? 'boost' : steering ? 'move' : 'idle';
  ship.angle = turnToward(ship.angle, Math.atan2(c.aimY - ship.y, c.aimX - ship.x), ship.stats.turnRate * dt);
  if (c.fire && ship.fireTimer <= 0 && !ship.merge && ship.frozen <= 0) fire(state, ship, ship.stats.fireCooldown, 0);
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
  if (ship.frozen > 0) return;
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
function addBullet(state: GameState, ship: Ship, x: number, y: number, angle: number) {
  const st = ship.stats;
  state.bullets.push({
    team: ship.team,
    sprite: typeOf(ship).sprites.bullet,
    tier: ship.tier,
    x,
    y,
    vx: Math.cos(angle) * st.bulletSpeed,
    vy: Math.sin(angle) * st.bulletSpeed,
    life: st.bulletLife,
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
export function damageShip(state: GameState, s: Ship, amount: number) {
  if (s.dead) return false;
  if (s.shield > 0) {
    const absorbed = Math.min(s.shield, amount);
    s.shield -= absorbed;
    amount -= absorbed;
  }
  if (!(s.team === 'player' && state.invincible)) s.hp -= amount;
  if (s.hp <= 0) s.dead = true;
  return s.dead;
}

/** Turn a homing missile toward its target, or the nearest enemy if its target is gone. */
function steerMissile(state: GameState, b: Bullet, dt: number) {
  // Missiles launch slowly and speed up to full speed over CONFIG.missiles.rampTime.
  const M = CONFIG.missiles;
  const age = M.life - b.life;
  const speed = M.startSpeed + (M.speed - M.startSpeed) * Math.min(1, age / M.rampTime);
  const heading = Math.atan2(b.vy, b.vx);
  b.vx = Math.cos(heading) * speed;
  b.vy = Math.sin(heading) * speed;
  if (!b.target || b.target.dead || b.target.merge) {
    b.target = null;
    let bestD = 500 * 500;
    for (const s of state.ships) {
      if (s.team === b.team || s.dead || s.merge) continue;
      const d = distSq(b.x, b.y, s.x, s.y);
      if (d < bestD) {
        bestD = d;
        b.target = s;
      }
    }
  }
  if (!b.target) return;
  const now = Math.atan2(b.vy, b.vx);
  const want = Math.atan2(b.target.y - b.y, b.target.x - b.x);
  const turn = clamp(wrapAngle(want - now), -b.homing * dt, b.homing * dt);
  b.vx = Math.cos(now + turn) * speed;
  b.vy = Math.sin(now + turn) * speed;
}

function updateBullets(state: GameState, dt: number) {
  for (const b of state.bullets) {
    if (b.homing > 0) steerMissile(state, b, dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    for (const s of state.ships) {
      // Merging ships can't be hit: shots pass through.
      if (s.team === b.team || s.dead || s.merge) continue;
      const r = s.stats.radius + b.radius;
      if (distSq(b.x, b.y, s.x, s.y) > r * r) continue;
      damageShip(state, s, b.damage);
      b.life = 0;
      addEffect(state, 'vfx.hit', b.x, b.y, 0, b.tier);
      addSound(state, 'sfx.hit', b, b.tier);
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
      gainXp(state, tierValue(s.tier) * CONFIG.levels.xpPerValue * (s.elite ? CONFIG.elite.xpMultiplier : 1));
      if (!s.elite) maybeDropItem(state, s);
    } else {
      state.stats.losses++;
      state.stats.lossValue += tierValue(s.tier);
    }
    // Bigger enemies leave wrecks less often.
    // Your first kill of a run always leaves one.
    const firstKill = s.team === 'enemy' && state.stats.kills === 1 && CONFIG.firstKillWreck;
    let wreckChance = firstKill ? 1 : CONFIG.wreckChance * CONFIG.tiers.wreckChancePerTier ** (s.tier - 1);
    let wreckTier = s.tier;
    if (s.elite) {
      // An elite always drops a wreck, a (better) item, or both.
      const drop = eliteDrop();
      if (drop !== 'wreck') dropItem(state, s, eliteRarityWeights());
      wreckChance = firstKill || drop !== 'item' ? 1 : 0;
      // Its wreck never lets you jump too far ahead of your biggest ship.
      wreckTier = Math.min(s.tier, state.maxTier + CONFIG.elite.wreckMaxTiersAbove);
    }
    if (s.team === 'enemy' && Math.random() < wreckChance) {
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
  state.ships = state.ships.filter((s) => !s.dead);
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

/** Rarity odds for an elite's item (better than normal drops). */
const eliteRarityWeights = (): Record<Rarity, number> => {
  const E = CONFIG.elite;
  return { common: E.commonWeight, uncommon: E.uncommonWeight, rare: E.rareWeight, epic: E.epicWeight };
};

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
  if (state.elitesEnabled && state.wave >= E.firstWave && state.wave % E.everyNthWave === 0) state.eliteDue = true;
  if (state.eliteDue && !fleetWave) {
    state.eliteDue = false;
    if (state.elitesEnabled) spawnElite(state, center, spawnDistance);
  }

  if (fleetWave) {
    // One enemy fleet in formation. It grows with the wave number (see curves.ts), not with your fleet.
    spawnEnemyFleet(state, center, spawnDistance, enemyFleetValue(state.wave), room);
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
  // Biggest ships first, so the biggest one leads.
  for (let t = counts.length - 1; t >= 0; t--)
    for (let i = 0; i < counts[t]; i++) addShip(state, 'enemy', 'fighter', t + 1, fleet, 0, 0, facing);
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

/**
 * Spawn an elite: one strong enemy that uses skills. Its tier is the biggest
 * tier an enemy fleet of this wave would have (plus CONFIG.elite.extraTiers).
 */
function spawnElite(state: GameState, near: Ship, distance: number) {
  const E = CONFIG.elite;
  const counts = tierCounts(enemyFleetValue(state.wave));
  let top = 1;
  counts.forEach((n, i) => {
    if (n > 0) top = i + 1;
  });
  const a = Math.random() * Math.PI * 2;
  const fleet = newFleet('enemy');
  const ship = addShip(state, 'enemy', 'fighter', top + E.extraTiers, fleet, 0, 0, a + Math.PI);
  ship.stats.maxHp = Math.round(ship.stats.maxHp * E.healthMultiplier);
  ship.hp = ship.stats.maxHp;
  ship.elite = { skills: makeEliteSkills(state.elitesSpawned), laserCharge: 0 };
  ship.x = near.x + Math.cos(a) * (distance + ship.stats.radius);
  ship.y = near.y + Math.sin(a) * (distance + ship.stats.radius);
  fleet.leader = ship;
  state.enemyFleets.push(fleet);
  state.elitesSpawned++;
  state.eliteAlertTime = state.time;
  addSound(state, 'sfx.alert', near, 1, 1, true);
}

// ---------- Test tools (only reachable from dev-mode keys) ----------

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
  state.effects.push({ sprite, tier, x, y, angle, age: 0, scale });
}

function updateEffects(state: GameState, dt: number) {
  for (const e of state.effects) e.age += dt;
  state.effects = state.effects.filter((e) => e.age < state.effectDuration(e.sprite, e.tier));
}
