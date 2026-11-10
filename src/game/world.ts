// The game rules: ships, fleets, shooting, wrecks, enemy waves.
// No drawing happens here, only updating numbers.

import { approach, clamp, distSq, randRange, turnToward, wrapAngle } from '../engine/math';
import { CONFIG, SHIP_TYPES, type ShipType, type ShipTypeId } from './config';

export type Team = 'player' | 'enemy';
export type Thrust = 'idle' | 'move' | 'boost';

/** Ships slower than this count as idle (engine off) for picking their image. */
const MOVING_SPEED = 25;

export interface Ship {
  id: number;
  team: Team;
  type: ShipTypeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  fireTimer: number;
  fleet: Fleet;
  dead: boolean;
  /** What the engine is doing. Picks the image: normal, ".move" or ".boost". */
  thrust: Thrust;
}

/** A group of ships that fly together. The leader decides where the fleet goes. */
export interface Fleet {
  team: Team;
  leader: Ship | null;
  members: Ship[];
}

export interface Bullet {
  team: Team;
  sprite: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
}

export interface Wreck {
  type: ShipTypeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  life: number;
}

/** A visual effect that plays once (explosion, hit spark...). */
export interface Effect {
  sprite: string;
  x: number;
  y: number;
  angle: number;
  age: number;
}

export interface GameState {
  time: number;
  ships: Ship[];
  bullets: Bullet[];
  wrecks: Wreck[];
  effects: Effect[];
  playerFleet: Fleet;
  enemyFleets: Fleet[];
  wave: number;
  waveTimer: number;
  maxFleetSize: number;
  zoom: number;
  gameOver: boolean;
  /** Test mode: your ships take no damage. */
  invincible: boolean;
  nextId: number;
  /** How long an effect's animation lasts. Comes from the art, so it's passed in. */
  effectDuration: (sprite: string) => number;
}

/** What the player is doing this step. Aim is in world coordinates. */
export interface Controls {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
  boost: boolean;
}

export const typeOf = (ship: Ship): ShipType => SHIP_TYPES[ship.type];

/** Full health for a ship. Your ships get a bonus over enemies. */
export const maxHpOf = (ship: Pick<Ship, 'type' | 'team'>) =>
  Math.round(SHIP_TYPES[ship.type].maxHp * (ship.team === 'player' ? CONFIG.playerHpMultiplier : 1));

// ---------- Setup ----------

export function createGame(effectDuration: (sprite: string) => number): GameState {
  const state: GameState = {
    time: 0,
    ships: [],
    bullets: [],
    wrecks: [],
    effects: [],
    playerFleet: { team: 'player', leader: null, members: [] },
    enemyFleets: [],
    wave: 0,
    waveTimer: CONFIG.firstWaveDelay,
    maxFleetSize: 1,
    zoom: CONFIG.zoomSteps[0].zoom,
    gameOver: false,
    invincible: false,
    nextId: 1,
    effectDuration,
  };
  const flagship = addShip(state, 'player', 'fighter', state.playerFleet, 0, 0, -Math.PI / 2);
  state.playerFleet.leader = flagship;
  return state;
}

function addShip(state: GameState, team: Team, type: ShipTypeId, fleet: Fleet, x: number, y: number, angle: number) {
  const ship: Ship = {
    id: state.nextId++,
    team,
    type,
    x,
    y,
    vx: 0,
    vy: 0,
    angle,
    hp: maxHpOf({ type, team }),
    fireTimer: Math.random() * 0.5,
    fleet,
    dead: false,
    thrust: 'idle',
  };
  state.ships.push(ship);
  fleet.members.push(ship);
  return ship;
}

/** The ship the player is currently flying (null if the whole fleet is gone). */
export const controlledShip = (state: GameState) => state.playerFleet.leader;

// ---------- Formation ----------

/**
 * Position of formation slot `i` around the leader. Ring 1 has 6 slots,
 * ring 2 has 12, ring 3 has 18, and so on.
 */
function slotOffset(i: number) {
  let ring = 1;
  while (i >= ring * 6) {
    i -= ring * 6;
    ring++;
  }
  const count = ring * 6;
  const a = (i / count) * Math.PI * 2 + (ring % 2 === 0 ? Math.PI / count : 0) - Math.PI / 2;
  const r = ring * CONFIG.formationSpacing;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

// ---------- Update ----------

export function updateGame(state: GameState, controls: Controls, dt: number, spawnDistance: number) {
  state.time += dt;
  updateEffects(state, dt);
  if (state.gameOver) return;

  updatePlayerLeader(state, controls, dt);
  for (const fleet of [state.playerFleet, ...state.enemyFleets]) updateFleet(state, fleet, dt);
  separateShips(state, dt);

  for (const s of state.ships) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.fireTimer -= dt;
  }

  updateBullets(state, dt);
  removeDeadShips(state);
  updateWrecks(state, dt);
  updateWaves(state, dt, spawnDistance);

  const size = state.playerFleet.members.length;
  state.maxFleetSize = Math.max(state.maxFleetSize, size);
  // Zoom follows the biggest fleet you've had, so it doesn't jump back and forth in a fight.
  for (const step of CONFIG.zoomSteps) if (state.maxFleetSize >= step.minFleet) state.zoom = step.zoom;
  if (size === 0) state.gameOver = true;
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

function updatePlayerLeader(state: GameState, c: Controls, dt: number) {
  const ship = controlledShip(state);
  if (!ship) return;
  const t = typeOf(ship);
  const len = Math.hypot(c.moveX, c.moveY);
  const mx = len > 0 ? c.moveX / len : 0;
  const my = len > 0 ? c.moveY / len : 0;
  // Boost only counts while you're actually steering somewhere.
  const boosting = c.boost && len > 0;
  const mul = boosting ? t.boostMultiplier : 1;
  steer(ship, mx * t.maxSpeed * mul, my * t.maxSpeed * mul, t.accel * mul, dt);
  ship.thrust = boosting ? 'boost' : len > 0 ? 'move' : 'idle';
  ship.angle = turnToward(ship.angle, Math.atan2(c.aimY - ship.y, c.aimX - ship.x), t.turnRate * dt);
  if (c.fire && ship.fireTimer <= 0) fire(state, ship, t.fireCooldown, 0);
}

function findNearestEnemy(state: GameState, ship: Ship, maxDist: number): Ship | null {
  let best: Ship | null = null;
  let bestD = maxDist * maxDist;
  for (const other of state.ships) {
    if (other.team === ship.team || other.dead) continue;
    const d = distSq(ship.x, ship.y, other.x, other.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function updateFleet(state: GameState, fleet: Fleet, dt: number) {
  const leader = fleet.leader;
  if (!leader) return;
  if (fleet.team === 'enemy') updateEnemyLeader(state, leader, dt);

  let slot = 0;
  for (const ship of fleet.members) {
    if (ship === leader) continue;
    const t = typeOf(ship);
    const speedMul = ship.team === 'enemy' ? CONFIG.enemySpeedMultiplier : 1;
    // Fly toward this ship's slot in the formation, matching the leader's speed.
    const off = slotOffset(slot++);
    const tx = leader.x + off.x - ship.x;
    const ty = leader.y + off.y - ship.y;
    let wantVx = leader.vx + tx * 3;
    let wantVy = leader.vy + ty * 3;
    const wantLen = Math.hypot(wantVx, wantVy);
    // When the leader boosts, the whole formation boosts to keep up.
    const boosting = leader.thrust === 'boost';
    const boostMul = boosting ? t.boostMultiplier : 1;
    const maxV = t.maxSpeed * speedMul * 1.5 * boostMul;
    if (wantLen > maxV) {
      wantVx *= maxV / wantLen;
      wantVy *= maxV / wantLen;
    }
    steer(ship, wantVx, wantVy, t.accel * boostMul, dt);
    const moving = Math.hypot(ship.vx, ship.vy) > MOVING_SPEED;
    ship.thrust = !moving ? 'idle' : boosting ? 'boost' : 'move';
    aimAndShoot(state, ship, dt, leader.angle);
  }
}

/** AI: turn toward the nearest enemy in range and shoot. Otherwise face `idleAngle`. */
function aimAndShoot(state: GameState, ship: Ship, dt: number, idleAngle: number) {
  const t = typeOf(ship);
  const target = findNearestEnemy(state, ship, t.range);
  if (!target) {
    ship.angle = turnToward(ship.angle, idleAngle, t.turnRate * dt);
    return;
  }
  const enemy = ship.team === 'enemy';
  let aimX = target.x;
  let aimY = target.y;
  if (enemy ? CONFIG.enemyLeadsTargets : CONFIG.allyLeadsTargets) {
    // Aim where the target will be when the bullet arrives.
    const travel = Math.hypot(target.x - ship.x, target.y - ship.y) / t.bulletSpeed;
    aimX += target.vx * travel;
    aimY += target.vy * travel;
  }
  const want = Math.atan2(aimY - ship.y, aimX - ship.x);
  ship.angle = turnToward(ship.angle, want, t.turnRate * dt);
  if (ship.fireTimer <= 0 && Math.abs(wrapAngle(want - ship.angle)) < 0.25) {
    const mul = enemy ? CONFIG.enemyFireCooldownMultiplier : CONFIG.allyFireCooldownMultiplier;
    const spread = enemy ? CONFIG.enemyAimSpread : CONFIG.allyAimSpread;
    fire(state, ship, t.fireCooldown * mul * randRange(0.85, 1.15), spread);
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
  const preferred = ship.fleet.members.length > 3 ? 60 : CONFIG.enemyPreferredDistance;
  if (d > preferred) {
    steer(ship, nx * speed, ny * speed, t.accel, dt);
  } else {
    const dir = ship.id % 2 ? 1 : -1;
    steer(ship, -ny * speed * 0.6 * dir, nx * speed * 0.6 * dir, t.accel, dt);
  }
  aimAndShoot(state, ship, dt, Math.atan2(dy, dx));
  ship.thrust = Math.hypot(ship.vx, ship.vy) > MOVING_SPEED ? 'move' : 'idle';
}

/** Gently push apart ships of the same team that overlap. */
function separateShips(state: GameState, dt: number) {
  const ships = state.ships;
  for (let i = 0; i < ships.length; i++)
    for (let j = i + 1; j < ships.length; j++) {
      const a = ships[i];
      const b = ships[j];
      if (a.team !== b.team) continue;
      const minD = typeOf(a).radius + typeOf(b).radius;
      const d2 = distSq(a.x, a.y, b.x, b.y);
      if (d2 >= minD * minD || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const push = ((minD - d) / d) * 200 * dt;
      const px = (a.x - b.x) * push;
      const py = (a.y - b.y) * push;
      a.vx += px;
      a.vy += py;
      b.vx -= px;
      b.vy -= py;
    }
}

function fire(state: GameState, ship: Ship, cooldown: number, spread: number) {
  const t = typeOf(ship);
  ship.fireTimer = cooldown;
  const a = ship.angle + randRange(-spread, spread);
  state.bullets.push({
    team: ship.team,
    sprite: t.bulletSprites[ship.team],
    x: ship.x + Math.cos(ship.angle) * t.gunOffset,
    y: ship.y + Math.sin(ship.angle) * t.gunOffset,
    vx: Math.cos(a) * t.bulletSpeed,
    vy: Math.sin(a) * t.bulletSpeed,
    life: t.bulletLife,
    damage: t.bulletDamage,
  });
}

function updateBullets(state: GameState, dt: number) {
  for (const b of state.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    for (const s of state.ships) {
      if (s.team === b.team || s.dead) continue;
      const r = typeOf(s).radius;
      if (distSq(b.x, b.y, s.x, s.y) > r * r) continue;
      if (!(s.team === 'player' && state.invincible)) s.hp -= b.damage;
      b.life = 0;
      addEffect(state, 'vfx.hit', b.x, b.y);
      if (s.hp <= 0) s.dead = true;
      break;
    }
  }
  state.bullets = state.bullets.filter((b) => b.life > 0);
}

function removeDeadShips(state: GameState) {
  for (const s of state.ships) {
    if (!s.dead) continue;
    addEffect(state, 'vfx.explosion', s.x, s.y, Math.random() * Math.PI * 2);
    if (s.team === 'enemy' && Math.random() < CONFIG.wreckChance) {
      state.wrecks.push({
        type: s.type,
        x: s.x,
        y: s.y,
        vx: s.vx * 0.3,
        vy: s.vy * 0.3,
        angle: s.angle,
        spin: randRange(-1, 1),
        life: CONFIG.wreckLifetime,
      });
    }
    const fleet = s.fleet;
    fleet.members = fleet.members.filter((m) => m !== s);
    if (fleet.leader === s) fleet.leader = pickNewLeader(fleet, s);
  }
  state.ships = state.ships.filter((s) => !s.dead);
  state.enemyFleets = state.enemyFleets.filter((f) => f.members.length > 0);
}

/** When a leader dies, the closest surviving ship takes command. */
function pickNewLeader(fleet: Fleet, old: Ship): Ship | null {
  let best: Ship | null = null;
  let bestD = Infinity;
  for (const m of fleet.members) {
    const d = distSq(m.x, m.y, old.x, old.y);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

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
    const magnetR = CONFIG.wreckMagnetRange;
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
    // Any ship in your fleet that touches a wreck recruits it.
    const r = SHIP_TYPES[w.type].radius;
    for (const s of state.playerFleet.members) {
      const reach = r + typeOf(s).radius;
      if (distSq(s.x, s.y, w.x, w.y) < reach * reach) {
        const ship = addShip(state, 'player', w.type, state.playerFleet, w.x, w.y, w.angle);
        ship.vx = s.vx;
        ship.vy = s.vy;
        addEffect(state, 'vfx.recruit', w.x, w.y);
        w.life = 0;
        break;
      }
    }
  }
  state.wrecks = state.wrecks.filter((w) => w.life > 0);
}

function updateWaves(state: GameState, dt: number, spawnDistance: number) {
  state.waveTimer -= dt;
  if (state.waveTimer > 0) return;
  state.waveTimer = CONFIG.waveInterval;
  state.wave++;
  const center = controlledShip(state);
  if (!center) return;

  const room = CONFIG.maxEnemies - state.ships.filter((s) => s.team === 'enemy').length;
  const playerSize = state.playerFleet.members.length;
  const fleetWave =
    playerSize >= CONFIG.enemyFleetMinPlayerSize && state.wave % CONFIG.enemyFleetEveryNthWave === 0;

  if (fleetWave) {
    // One enemy fleet in formation, a bit bigger than yours.
    const size = clamp(Math.round(playerSize * CONFIG.enemyFleetSizeRatio) + 2, 3, room);
    spawnEnemyFleet(state, center, spawnDistance, size);
  } else {
    // A handful of lone fighters from random directions.
    const count = Math.min(
      1 + Math.floor(state.wave * CONFIG.loneEnemiesPerWave),
      CONFIG.maxLoneEnemiesPerWave,
      room,
    );
    for (let i = 0; i < count; i++) spawnEnemyFleet(state, center, spawnDistance, 1);
  }
}

function spawnEnemyFleet(state: GameState, near: Ship, distance: number, size: number) {
  if (size <= 0) return;
  const a = Math.random() * Math.PI * 2;
  const x = near.x + Math.cos(a) * distance;
  const y = near.y + Math.sin(a) * distance;
  const facing = a + Math.PI;
  const fleet: Fleet = { team: 'enemy', leader: null, members: [] };
  fleet.leader = addShip(state, 'enemy', 'fighter', fleet, x, y, facing);
  for (let i = 0; i < size - 1; i++) {
    const off = slotOffset(i);
    addShip(state, 'enemy', 'fighter', fleet, x + off.x, y + off.y, facing);
  }
  state.enemyFleets.push(fleet);
}

// ---------- Test tools (only reachable from dev-mode keys) ----------

/** Adds a ship to your fleet right next to the flagship. */
export function testAddShip(state: GameState) {
  const leader = controlledShip(state);
  if (!leader) return;
  const a = Math.random() * Math.PI * 2;
  const x = leader.x + Math.cos(a) * 50;
  const y = leader.y + Math.sin(a) * 50;
  addShip(state, 'player', leader.type, state.playerFleet, x, y, leader.angle);
  addEffect(state, 'vfx.recruit', x, y);
  state.maxFleetSize = Math.max(state.maxFleetSize, state.playerFleet.members.length);
}

/** Destroys one ship of your fleet (never the one you're flying). */
export function testRemoveShip(state: GameState) {
  const leader = controlledShip(state);
  const victim = [...state.playerFleet.members].reverse().find((s) => s !== leader);
  if (victim) victim.dead = true;
}

/** Destroys every enemy inside the given area (they can still leave wrecks). */
export function testKillEnemies(state: GameState, view: { x: number; y: number; w: number; h: number }) {
  for (const s of state.ships)
    if (s.team === 'enemy' && s.x >= view.x && s.x <= view.x + view.w && s.y >= view.y && s.y <= view.y + view.h)
      s.dead = true;
}

function addEffect(state: GameState, sprite: string, x: number, y: number, angle = 0) {
  state.effects.push({ sprite, x, y, angle, age: 0 });
}

function updateEffects(state: GameState, dt: number) {
  for (const e of state.effects) e.age += dt;
  state.effects = state.effects.filter((e) => e.age < state.effectDuration(e.sprite));
}
