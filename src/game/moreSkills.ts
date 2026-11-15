// The newer skills (docs/SKILLS.md): Gatling Laser, Crescent Strike, Arc
// Impulse, Ion Cloud, Plasma Lance, Splitting Beam, Laser Pods, Gravity Well,
// Scramble, Wrecksplosion, Tractor Beam, Force Wall, Cloaking, Hijack. Most of them leave "skill objects" in the
// world (a crescent in flight, a cloud's balls, a lance on a ship) that live
// for a moment; updateSkillObjects moves them and does their damage, and
// render.ts draws them by kind. Like world.ts, nothing is drawn here.

import { clamp, distSq, randRange, wrapAngle } from '../engine/math';
import { CONFIG } from './config';
import { modsOf, powerOf } from './skills';
import { cooldownOf } from './skills';
import {
  addEffect,
  addSound,
  damageShip,
  hijackShip,
  statsFor,
  tierValue,
  type Controls,
  type Fleet,
  type GameState,
  type OwnedSkill,
  type Ship,
  type Team,
  type Wreck,
} from './world';

/** Something a skill left in the world for a moment. */
export interface SkillObj {
  kind:
    | 'gatling'
    | 'crescent'
    | 'arcChain'
    | 'arcBolt'
    | 'ionBall'
    | 'lance'
    | 'splitBeam'
    | 'pod'
    | 'well'
    | 'scrambleWave'
    | 'thrown'
    | 'scrap'
    | 'wall'
    | 'hijackPulse';
  team: Team;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Which way it points (crescent: its flight direction). */
  angle: number;
  age: number;
  /** Seconds it lasts. */
  life: number;
  damage: number;
  /** Hit radius (crescent), blast radius (ion ball), half width (lance). */
  radius: number;
  /** Drawn this many times its normal size. */
  scale: number;
  /** The ship it belongs to (a lance stays on it, a volley fires from it). */
  owner?: Ship;
  /** Ships already hit (a crescent hits each one once). */
  hit?: Set<Ship>;
  /** Crescent: stops after hitting this many ships (elites only). */
  maxHits?: number;
  /** Lance: seconds of warning flicker before it starts cutting (elites only). */
  warning?: number;
  /** Lance: how many times it has cut each ship (an elite's can only cut each a few times). */
  cuts?: Map<Ship, number>;
  /** Crescent: how fast its path turns (radians per second). */
  turn?: number;
  /** Things still to come: gatling bolts, arc bounces. */
  left?: number;
  /** Seconds until the next bolt, bounce or damage tick. */
  timer?: number;
  /** Where a gatling volley aims. */
  aimX?: number;
  aimY?: number;
  /** Arc chain: the ship it just hit. */
  target?: Ship | null;
  /** Splitting Beam: splits it can still make. */
  splits?: number;
  /** Pod: when it stops gliding and starts shooting (seconds after launch). */
  readyAt?: number;
  /** Thrown wreck (Tractor Beam): the wreck it was, for drawing. */
  wreck?: Wreck;
  /** Force Wall: its points (the wall runs from one to the next), how much length it may still use, and whether it's still being drawn. */
  points?: { x: number; y: number }[];
  budget?: number;
  drawing?: boolean;
  /** Force Wall: the skill that made it (its cooldown starts when the wall is finished). */
  skill?: OwnedSkill;
  /** Hijack pulse: fleet value it may still take over, and how long hijacked ships stay hijacked. */
  value?: number;
  duration?: number;
  /** Arc bolt: where it starts (it's drawn from here to x, y). Lance: its length. */
  fromX?: number;
  fromY?: number;
  length?: number;
}

/** Enemies of `team` that can be hit right now. */
const targetsOf = (state: GameState, team: Team) => state.ships.filter((s) => s.team !== team && !s.dead && !s.merge);

/** Enemies of `team` a skill can pick as a target: like targetsOf, but not cloaked ones (they can't be seen). */
const visibleTargetsOf = (state: GameState, team: Team) => targetsOf(state, team).filter((s) => !s.ghost);

/** Size multiplier of a ship's skill art and areas: its tier size times size cards. */
const sizeOf = (ship: Ship, mods: { size: number }) => ship.stats.size * mods.size;

/** Distances that grow with tier like shot range (lasers, bolts). */
const rangeOf = (ship: Ship) => CONFIG.tiers.rangePerTier ** (ship.tier - 1);

// ---------- Using the skills ----------

/** Gatling Laser: a volley of bolts fired one after another toward the aim point. */
export function fireGatling(state: GameState, ship: Ship, c: Controls, sk: OwnedSkill) {
  const G = CONFIG.gatling;
  const mods = modsOf(state, ship, sk);
  state.skillObjs.push({
    kind: 'gatling',
    team: ship.team,
    tier: ship.tier,
    x: ship.x,
    y: ship.y,
    vx: 0,
    vy: 0,
    angle: 0,
    age: 0,
    life: Infinity,
    damage: G.damage * powerOf(state, ship) * mods.power,
    radius: 0,
    scale: 1,
    owner: ship,
    left: Math.max(1, G.bolts + Math.round(mods.count)),
    timer: 0,
    aimX: c.aimX,
    aimY: c.aimY,
  });
}

/** Crescent Strike: a spinning crescent flies toward the aim point, curving to one side (alternating). */
export function fireCrescent(state: GameState, ship: Ship, c: Controls, sk: OwnedSkill) {
  const C = CONFIG.crescent;
  const mods = modsOf(state, ship, sk);
  const size = sizeOf(ship, mods);
  // It flies along a circle (curving left and right in turn) that passes through the aim point,
  // then keeps curving past it. The circle's size comes from distance and curve.
  sk.flip = -(sk.flip ?? 1);
  const distance = C.distance * size;
  const radius = distance / ((C.curve * Math.PI) / 180);
  const toAim = Math.min(Math.hypot(c.aimX - ship.x, c.aimY - ship.y), radius * 1.99);
  // How much it turns before reaching the aim point; it starts out half that to the other side.
  const turnToAim = 2 * Math.asin(toAim / (2 * radius));
  const a = Math.atan2(c.aimY - ship.y, c.aimX - ship.x) - (turnToAim / 2) * sk.flip;
  const speed = distance / C.flightTime;
  state.skillObjs.push({
    kind: 'crescent',
    team: ship.team,
    tier: ship.tier,
    x: ship.x,
    y: ship.y,
    vx: Math.cos(a) * speed,
    vy: Math.sin(a) * speed,
    angle: a,
    age: 0,
    life: C.flightTime,
    damage: C.damage * powerOf(state, ship) * mods.power,
    radius: C.radius * size,
    scale: size,
    hit: new Set(),
    turn: (speed / radius) * sk.flip,
    // Fairness: an elite's crescent can't cut through a whole fleet.
    maxHits: ship.elite ? CONFIG.elite.crescentMaxHits : undefined,
  });
  addSound(state, 'sfx.crescent', ship, ship.tier);
}

/** Arc Impulse: hits the enemy nearest the aim point (within range), then bounces. Stays ready if nothing's in range. */
export function fireArc(state: GameState, ship: Ship, c: Controls, sk: OwnedSkill): boolean {
  const A = CONFIG.arcImpulse;
  const mods = modsOf(state, ship, sk);
  const range = A.range * rangeOf(ship);
  let first: Ship | null = null;
  let best = Infinity;
  for (const s of visibleTargetsOf(state, ship.team)) {
    if (distSq(s.x, s.y, ship.x, ship.y) > (range + s.stats.radius) ** 2) continue;
    const d = distSq(s.x, s.y, c.aimX, c.aimY);
    if (d < best) {
      best = d;
      first = s;
    }
  }
  if (!first) return false;
  const chain: SkillObj = {
    kind: 'arcChain',
    team: ship.team,
    tier: ship.tier,
    x: ship.x + Math.cos(ship.angle) * ship.stats.gunOffset,
    y: ship.y + Math.sin(ship.angle) * ship.stats.gunOffset,
    vx: 0,
    vy: 0,
    angle: 0,
    age: 0,
    life: Infinity,
    damage: A.damage * powerOf(state, ship) * mods.power,
    radius: A.bounceRange * rangeOf(ship),
    scale: ship.stats.size,
    hit: new Set(),
    // Fairness: an elite's arc bounces only a little.
    left: ship.elite ? CONFIG.elite.arcBounces : Math.max(0, A.bounces + Math.round(mods.count)),
    timer: 0,
    target: first,
  };
  state.skillObjs.push(chain);
  addSound(state, 'sfx.arc', ship, ship.tier);
  return true;
}

/** Ion Cloud: balls spread around a point that travels toward the aim point; each blows up on its own fuse. */
export function fireIonCloud(state: GameState, ship: Ship, c: Controls, sk: OwnedSkill) {
  const I = CONFIG.ionCloud;
  const mods = modsOf(state, ship, sk);
  const size = sizeOf(ship, mods);
  const a = Math.atan2(c.aimY - ship.y, c.aimX - ship.x);
  const count = Math.max(1, I.balls + Math.round(mods.count));
  const damage = I.damage * powerOf(state, ship) * mods.power;
  for (let i = 0; i < count; i++) {
    // Each ball heads for its own spot in the cloud, and slows to a stop there.
    const r = Math.sqrt(Math.random()) * I.spread * size;
    const t = Math.random() * Math.PI * 2;
    const dx = Math.cos(a) * I.distance * ship.stats.size + Math.cos(t) * r;
    const dy = Math.sin(a) * I.distance * ship.stats.size + Math.sin(t) * r;
    state.skillObjs.push({
      kind: 'ionBall',
      team: ship.team,
      tier: ship.tier,
      x: ship.x,
      y: ship.y,
      // Covering the distance in travelTime while slowing evenly to a stop: start at twice the average speed.
      vx: ship.vx + (2 * dx) / I.travelTime,
      vy: ship.vy + (2 * dy) / I.travelTime,
      angle: Math.random() * Math.PI * 2,
      age: 0,
      life: randRange(I.fuseMin, I.fuseMax),
      damage,
      radius: I.blastRadius * size,
      scale: size,
    });
  }
  addSound(state, 'sfx.ion-cloud', ship, ship.tier);
}

/** Plasma Lance: a blade stuck to the front of the ship for a moment, hurting what it touches. */
export function firePlasmaLance(state: GameState, ship: Ship, sk: OwnedSkill) {
  const P = CONFIG.plasmaLance;
  const mods = modsOf(state, ship, sk);
  const size = sizeOf(ship, mods);
  // Fairness: an elite's lance flickers as a warning first, and cuts less hard.
  const warning = ship.elite ? CONFIG.elite.lanceWarning : 0;
  state.skillObjs.push({
    kind: 'lance',
    team: ship.team,
    tier: ship.tier,
    x: ship.x,
    y: ship.y,
    vx: 0,
    vy: 0,
    angle: ship.angle,
    age: 0,
    life: P.duration + warning,
    damage: P.damage * powerOf(state, ship) * mods.power * (ship.elite ? CONFIG.elite.lanceDamage : 1),
    radius: (P.width * size) / 2,
    warning,
    cuts: ship.elite ? new Map() : undefined,
    scale: size,
    owner: ship,
    length: P.length * size,
    timer: 0,
  });
  addSound(state, 'sfx.plasma-lance', ship, ship.tier);
}

/** Splitting Beam: a fast beam toward the aim point that splits when it hits. */
export function fireSplitBeam(state: GameState, ship: Ship, c: Controls, sk: OwnedSkill) {
  const B = CONFIG.splitBeam;
  const mods = modsOf(state, ship, sk);
  const most = ship.elite ? CONFIG.elite.splitBeamSplits : B.maxSplits;
  const a = Math.atan2(c.aimY - ship.y, c.aimX - ship.x);
  addSplitBeam(state, ship.team, ship.tier, ship.x + Math.cos(a) * ship.stats.gunOffset, ship.y + Math.sin(a) * ship.stats.gunOffset, a, {
    damage: B.damage * powerOf(state, ship) * mods.power,
    range: B.range * rangeOf(ship),
    splits: clamp(B.splits + Math.round(mods.count), 0, most),
    scale: ship.stats.size,
    hit: new Set(),
  });
  addSound(state, 'sfx.split-beam', ship, ship.tier);
}

function addSplitBeam(
  state: GameState,
  team: Team,
  tier: number,
  x: number,
  y: number,
  angle: number,
  b: { damage: number; range: number; splits: number; scale: number; hit: Set<Ship> },
) {
  const speed = CONFIG.splitBeam.speed;
  state.skillObjs.push({
    kind: 'splitBeam',
    team,
    tier,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    angle,
    age: 0,
    life: b.range / speed,
    damage: b.damage,
    radius: 3 * b.scale,
    scale: b.scale,
    splits: b.splits,
    hit: b.hit,
  });
}

/** Laser Pods: pods glide out in a cone in front of the ship, then each shoots its own target. */
export function launchPods(state: GameState, ship: Ship, sk: OwnedSkill) {
  const P = CONFIG.laserPods;
  const mods = modsOf(state, ship, sk);
  const count = Math.max(1, P.pods + Math.round(mods.count));
  const cone = (P.cone * Math.PI) / 180;
  const glide = P.glide * ship.stats.size;
  for (let i = 0; i < count; i++) {
    const a = ship.angle + (count === 1 ? 0 : (i / (count - 1) - 0.5) * cone);
    state.skillObjs.push({
      kind: 'pod',
      team: ship.team,
      tier: ship.tier,
      x: ship.x,
      y: ship.y,
      // Glides out, slowing evenly to a stop (like the ion balls).
      vx: ship.vx + (Math.cos(a) * 2 * glide) / P.glideTime,
      vy: ship.vy + (Math.sin(a) * 2 * glide) / P.glideTime,
      angle: a,
      age: 0,
      life: P.glideTime + P.duration,
      damage: P.damage * powerOf(state, ship) * mods.power,
      radius: 0,
      scale: ship.stats.size,
      readyAt: P.glideTime,
      timer: i * 0.08,
      target: null,
    });
  }
  addSound(state, 'sfx.pods', ship, ship.tier);
}

/** Gravity Well: opens at the aim point and pulls enemies toward its middle for a while. */
export function openGravityWell(state: GameState, ship: Ship, c: Controls, sk: OwnedSkill) {
  const G = CONFIG.gravityWell;
  const mods = modsOf(state, ship, sk);
  const size = sizeOf(ship, mods);
  state.skillObjs.push({
    kind: 'well',
    team: ship.team,
    tier: ship.tier,
    x: c.aimX,
    y: c.aimY,
    vx: 0,
    vy: 0,
    angle: 0,
    age: 0,
    life: G.duration,
    // Pull speed at the middle (an elite's pulls your ships less hard).
    damage: G.pull * mods.power * (ship.elite ? CONFIG.elite.wellPull : 1),
    radius: G.radius * size,
    scale: size,
  });
  addSound(state, 'sfx.gravity-well', { x: c.aimX, y: c.aimY }, ship.tier);
}

/** Scramble: a wave out of the front of the ship; enemies it touches are scrambled. */
export function sendScramble(state: GameState, ship: Ship, sk: OwnedSkill) {
  const S = CONFIG.scramble;
  const mods = modsOf(state, ship, sk);
  const size = sizeOf(ship, mods);
  state.skillObjs.push({
    kind: 'scrambleWave',
    team: ship.team,
    tier: ship.tier,
    x: ship.x + Math.cos(ship.angle) * ship.stats.gunOffset,
    y: ship.y + Math.sin(ship.angle) * ship.stats.gunOffset,
    vx: Math.cos(ship.angle) * S.speed,
    vy: Math.sin(ship.angle) * S.speed,
    angle: ship.angle,
    age: 0,
    life: (S.distance * ship.stats.size) / S.speed,
    // How long it scrambles (an elite's scrambles your ships for less).
    damage: S.duration * mods.power * (ship.elite ? CONFIG.elite.scrambleDuration : 1),
    radius: (S.width * size) / 2,
    scale: size,
    hit: new Set(),
  });
  addSound(state, 'sfx.scramble', ship, ship.tier);
}

/** How much bigger and harder a wreck of this tier blows up or hits (×1.5 per tier above 1). */
const wreckPower = (tier: number, per: number) => per ** (tier - 1);

/**
 * Wrecksplosion: every wreck near the aim point blows up. Stays ready when
 * there's none. Elites never use wrecks (they're your recruits): theirs is a
 * scrap charge at your ship that warns with a ring first.
 */
export function wrecksplosion(state: GameState, ship: Ship, c: Controls, sk: OwnedSkill): boolean {
  const W = CONFIG.wrecksplosion;
  const mods = modsOf(state, ship, sk);
  const damage = W.damage * powerOf(state, ship) * mods.power;
  if (ship.elite) {
    state.skillObjs.push({
      kind: 'scrap',
      team: ship.team,
      tier: ship.tier,
      x: c.aimX,
      y: c.aimY,
      vx: 0,
      vy: 0,
      angle: 0,
      age: 0,
      life: CONFIG.elite.scrapWarning,
      damage: damage * CONFIG.elite.scrapDamage,
      radius: W.blastRadius * ship.stats.size * CONFIG.elite.scrapRadius,
      scale: ship.stats.size,
    });
    return true;
  }
  const radius = W.radius * ship.stats.size;
  const caught = state.wrecks.filter((w) => w.life > 0 && distSq(w.x, w.y, c.aimX, c.aimY) < radius * radius);
  if (!caught.length) return false;
  for (const w of caught) {
    const k = wreckPower(w.tier, W.perWreckTier);
    blast(state, ship.team, w.x, w.y, W.blastRadius * k, damage * k);
    w.life = 0;
  }
  // Show the reach around the cursor for a moment.
  addEffect(state, 'vfx.wreck-radius', c.aimX, c.aimY, 0, 1, radius / 64);
  addSound(state, 'sfx.wrecksplosion', { x: c.aimX, y: c.aimY }, Math.min(4, ship.tier + 1));
  return true;
}

/** A round blast: every enemy of `team` within `radius` takes `damage`. */
function blast(state: GameState, team: Team, x: number, y: number, radius: number, damage: number) {
  for (const t of targetsOf(state, team)) if (distSq(t.x, t.y, x, y) < (radius + t.stats.radius) ** 2) damageShip(state, t, damage);
  addEffect(state, 'vfx.wreck-blast', x, y, Math.random() * Math.PI * 2, 1, radius / CONFIG.wrecksplosion.blastRadius);
}

/**
 * Tractor Beam: grabs the nearest wrecks in reach and hurls them at the enemies
 * nearest the aim point. Stays ready when there's none. An elite throws a lump
 * of scrap from its side instead (never your wrecks).
 */
export function tractorBeam(state: GameState, ship: Ship, c: Controls, sk: OwnedSkill): boolean {
  const T = CONFIG.tractorBeam;
  const mods = modsOf(state, ship, sk);
  const count = ship.elite ? 1 : Math.max(1, T.beams + Math.round(mods.count));
  const reach = T.grabRange * ship.stats.size;
  let grabbed: Wreck[];
  if (ship.elite) {
    const side = ship.angle + Math.PI / 2;
    const scrap: Wreck = { type: ship.type, tier: 1, x: ship.x + Math.cos(side) * ship.stats.radius * 1.5, y: ship.y + Math.sin(side) * ship.stats.radius * 1.5, vx: 0, vy: 0, angle: ship.angle, spin: 2, life: 1 };
    grabbed = [scrap];
  } else {
    grabbed = state.wrecks
      .filter((w) => w.life > 0 && distSq(w.x, w.y, ship.x, ship.y) < reach * reach)
      .sort((a, b) => distSq(a.x, a.y, ship.x, ship.y) - distSq(b.x, b.y, ship.x, ship.y))
      .slice(0, count);
    if (!grabbed.length) return false;
  }
  // Targets: the enemies nearest the aim point, one each while there are enough.
  const targets = visibleTargetsOf(state, ship.team).sort((a, b) => distSq(a.x, a.y, c.aimX, c.aimY) - distSq(b.x, b.y, c.aimX, c.aimY));
  grabbed.forEach((w, i) => {
    w.life = 0;
    const k = wreckPower(w.tier, CONFIG.wrecksplosion.perWreckTier);
    state.skillObjs.push({
      kind: 'thrown',
      team: ship.team,
      tier: w.tier,
      x: w.x,
      y: w.y,
      vx: w.vx,
      vy: w.vy,
      angle: Math.atan2(c.aimY - w.y, c.aimX - w.x),
      age: 0,
      life: T.life,
      damage: T.damage * powerOf(state, ship) * mods.power * k * (ship.elite ? CONFIG.elite.scrapDamage : 1),
      radius: statsFor(w.type, 'enemy', w.tier).radius,
      scale: ship.stats.size,
      owner: ship,
      target: targets.length ? targets[i % targets.length] : null,
      wreck: { ...w, life: 1 },
    });
  });
  addSound(state, 'sfx.tractor-beam', ship, ship.tier);
  return true;
}

/**
 * Force Wall: while right click is held, a wall follows the cursor (see
 * updateWall). An elite builds a straight one at once, between it and you.
 */
export function forceWall(state: GameState, ship: Ship, c: Controls, sk: OwnedSkill) {
  const F = CONFIG.forceWall;
  const mods = modsOf(state, ship, sk);
  const drawTime = F.drawTime * mods.power;
  const budget = drawTime * F.lengthPerSecond * ship.stats.size;
  const wall: SkillObj = {
    kind: 'wall',
    team: ship.team,
    tier: ship.tier,
    x: c.aimX,
    y: c.aimY,
    vx: 0,
    vy: 0,
    angle: 0,
    age: 0,
    life: Infinity,
    damage: 0,
    radius: (F.thickness * ship.stats.size) / 2,
    scale: ship.stats.size,
    owner: ship,
    points: [{ x: c.aimX, y: c.aimY }],
    budget,
    drawing: true,
    timer: drawTime,
    skill: sk,
  };
  if (ship.elite) {
    // A straight wall across the line to you, 40% of the way there.
    const E = CONFIG.elite;
    const a = Math.atan2(c.aimY - ship.y, c.aimX - ship.x);
    const d = Math.hypot(c.aimX - ship.x, c.aimY - ship.y) * 0.4;
    const mx = ship.x + Math.cos(a) * d;
    const my = ship.y + Math.sin(a) * d;
    const half = (budget * E.wallScale) / 2;
    const px = -Math.sin(a);
    const py = Math.cos(a);
    const n = Math.max(2, Math.ceil((half * 2) / F.step));
    wall.points = Array.from({ length: n + 1 }, (_, i) => ({ x: mx + px * (i / n - 0.5) * half * 2, y: my + py * (i / n - 0.5) * half * 2 }));
    wall.drawing = false;
    wall.life = F.life * E.wallScale;
  } else {
    // Its cooldown starts when it's finished (see finishWall); until then it can't be used again.
    sk.timer = Infinity;
  }
  state.skillObjs.push(wall);
  addSound(state, 'sfx.force-wall', { x: c.aimX, y: c.aimY }, ship.tier);
}

/** Cloaking: the ship's whole fleet is hidden for a while (see updateCloaks). */
export function cloak(state: GameState, ship: Ship, sk: OwnedSkill) {
  const mods = modsOf(state, ship, sk);
  const duration = CONFIG.cloak.duration * mods.power * (ship.elite ? CONFIG.elite.cloakDuration : 1);
  ship.fleet.cloak = Math.max(ship.fleet.cloak, duration);
  hideFleet(ship.fleet);
  addEffect(state, 'vfx.cloak', ship.x, ship.y, 0, 1, ship.stats.size);
  addSound(state, 'sfx.cloak', ship, ship.tier);
}

/** Give every ship of a cloaked fleet that isn't hidden yet a "last seen" copy where it is now. */
function hideFleet(fleet: Fleet) {
  for (const m of fleet.members) if (!m.ghost) m.ghost = { ...m, vx: 0, vy: 0, ghost: null };
}

/** Hijack: a pulse spreads out from the ship and takes over enemies it reaches, nearest first, up to a fleet value. */
export function hijackPulse(state: GameState, ship: Ship, sk: OwnedSkill) {
  const H = CONFIG.hijack;
  const mods = modsOf(state, ship, sk);
  const elite = !!ship.elite;
  state.skillObjs.push({
    kind: 'hijackPulse',
    team: ship.team,
    tier: ship.tier,
    x: ship.x,
    y: ship.y,
    vx: 0,
    vy: 0,
    angle: 0,
    age: 0,
    life: H.pulseTime,
    damage: 0,
    // How far it has spread so far (grows to the full reach over pulseTime).
    radius: 0,
    length: H.radius * ship.stats.size,
    scale: ship.stats.size,
    owner: ship,
    hit: new Set(),
    // Grows with your ship's tier like skill damage (an elite's takes much less).
    value: H.value * CONFIG.tiers.powerPerTier ** (ship.tier - 1) * mods.power * (elite ? CONFIG.elite.hijackValue : 1),
    duration: H.duration * (elite ? CONFIG.elite.hijackDuration : 1),
    left: elite ? CONFIG.elite.hijackMaxShips : Infinity,
  });
  addSound(state, 'sfx.hijack', ship, ship.tier);
}

// ---------- Updating what they left in the world ----------

export function updateSkillObjects(state: GameState, dt: number, c: Controls) {
  updateCloaks(state, dt);
  for (const o of state.skillObjs) {
    o.age += dt;
    UPDATE[o.kind](state, o, dt, c);
  }
  state.skillObjs = state.skillObjs.filter((o) => o.age < o.life);
}

/** Cloaks wear off. While one lasts, ships joining the fleet are hidden too. */
function updateCloaks(state: GameState, dt: number) {
  for (const fleet of [state.playerFleet, ...state.enemyFleets]) {
    if (fleet.cloak <= 0) continue;
    fleet.cloak = Math.max(0, fleet.cloak - dt);
    if (fleet.cloak > 0) hideFleet(fleet);
    else for (const m of fleet.members) m.ghost = null;
  }
  // A ship that left a cloaked fleet (hijacked...) is seen again.
  for (const s of state.ships) if (s.ghost && s.fleet.cloak <= 0) s.ghost = null;
}

const UPDATE: Record<SkillObj['kind'], (state: GameState, o: SkillObj, dt: number, c: Controls) => void> = {
  gatling: updateGatling,
  crescent: updateCrescent,
  arcChain: updateArcChain,
  arcBolt: () => {},
  ionBall: updateIonBall,
  lance: updateLance,
  splitBeam: updateSplitBeam,
  pod: updatePod,
  well: updateWell,
  scrambleWave: updateScrambleWave,
  thrown: updateThrown,
  scrap: updateScrap,
  wall: updateWall,
  hijackPulse: updateHijackPulse,
};

function updateGatling(state: GameState, o: SkillObj, dt: number) {
  const G = CONFIG.gatling;
  const ship = o.owner;
  // The volley stops if its ship is gone (or merging).
  if (!ship || ship.dead || ship.merge || !o.left) {
    o.life = 0;
    return;
  }
  o.timer = (o.timer ?? 0) - dt;
  while (o.timer <= 0 && o.left > 0) {
    o.timer += G.boltInterval;
    o.left--;
    const a = Math.atan2((o.aimY ?? 0) - ship.y, (o.aimX ?? 0) - ship.x) + (randRange(-G.spread, G.spread) * Math.PI) / 180;
    const speed = G.speed * CONFIG.tiers.shotSpeedPerTier ** (ship.tier - 1);
    state.bullets.push({
      team: ship.team,
      sprite: 'projectile.gatling',
      tier: ship.tier,
      x: ship.x + Math.cos(a) * ship.stats.gunOffset,
      y: ship.y + Math.sin(a) * ship.stats.gunOffset,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: (G.range * rangeOf(ship)) / speed,
      damage: o.damage,
      radius: 2 * ship.stats.size,
      homing: 0,
      target: null,
    });
    addSound(state, 'sfx.gatling', ship, ship.tier, 0.6);
  }
}

function updateCrescent(state: GameState, o: SkillObj, dt: number) {
  // The path curves: turn the velocity a little every step.
  const turn = (o.turn ?? 0) * dt;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  [o.vx, o.vy] = [o.vx * c - o.vy * s, o.vx * s + o.vy * c];
  o.x += o.vx * dt;
  o.y += o.vy * dt;
  o.angle = Math.atan2(o.vy, o.vx);
  for (const t of targetsOf(state, o.team)) {
    if (o.hit!.has(t) || distSq(t.x, t.y, o.x, o.y) > (o.radius + t.stats.radius) ** 2) continue;
    o.hit!.add(t);
    damageShip(state, t, o.damage);
    addEffect(state, 'vfx.hit', t.x, t.y, 0, o.tier);
    if (o.maxHits && o.hit!.size >= o.maxHits) {
      o.life = 0;
      return;
    }
  }
}

function updateArcChain(state: GameState, o: SkillObj, dt: number) {
  o.timer = (o.timer ?? 0) - dt;
  if (o.timer > 0) return;
  o.timer = CONFIG.arcImpulse.jumpDelay;
  const t = o.target;
  if (!t || t.dead) {
    o.life = 0;
    return;
  }
  // Strike: a bolt from the last spot to this target.
  o.hit!.add(t);
  damageShip(state, t, o.damage);
  state.skillObjs.push({
    kind: 'arcBolt',
    team: o.team,
    tier: o.tier,
    x: t.x,
    y: t.y,
    vx: 0,
    vy: 0,
    angle: 0,
    age: 0,
    life: 0.25,
    damage: 0,
    radius: 0,
    scale: o.scale,
    fromX: o.x,
    fromY: o.y,
  });
  addEffect(state, 'vfx.arc-hit', t.x, t.y, Math.random() * Math.PI * 2, 1, o.scale);
  o.x = t.x;
  o.y = t.y;
  // Bounce on to the nearest enemy not hit yet, if there's one close enough.
  o.damage *= CONFIG.arcImpulse.falloff;
  o.target = null;
  if ((o.left ?? 0) <= 0) {
    o.life = 0;
    return;
  }
  o.left!--;
  let best = Infinity;
  for (const s of visibleTargetsOf(state, o.team)) {
    if (o.hit!.has(s)) continue;
    const d = distSq(s.x, s.y, o.x, o.y);
    if (d < best && d < (o.radius + s.stats.radius) ** 2) {
      best = d;
      o.target = s;
    }
  }
  if (!o.target) o.life = 0;
}

function updateIonBall(state: GameState, o: SkillObj, dt: number) {
  const I = CONFIG.ionCloud;
  // Slow evenly to a stop over the travel time (speed ∝ time left), then drift a little.
  if (o.age < I.travelTime) {
    const left = I.travelTime - o.age;
    o.vx *= left / (left + dt);
    o.vy *= left / (left + dt);
  } else {
    o.vx *= 0.95;
    o.vy *= 0.95;
  }
  o.x += o.vx * dt;
  o.y += o.vy * dt;
  if (o.age < o.life) return;
  // Fuse ran out: blow up.
  for (const t of targetsOf(state, o.team))
    if (distSq(t.x, t.y, o.x, o.y) < (o.radius + t.stats.radius) ** 2) damageShip(state, t, o.damage);
  addEffect(state, 'vfx.ion-pop', o.x, o.y, Math.random() * Math.PI * 2, 1, o.scale);
  addSound(state, 'sfx.ion-pop', o, o.tier, 0.5);
}

function updateLance(state: GameState, o: SkillObj, dt: number) {
  const ship = o.owner;
  if (!ship || ship.dead || ship.merge) {
    o.life = 0;
    return;
  }
  // Stuck to the front of the ship.
  o.angle = ship.angle;
  const dx = Math.cos(o.angle);
  const dy = Math.sin(o.angle);
  o.x = ship.x + dx * ship.stats.gunOffset;
  o.y = ship.y + dy * ship.stats.gunOffset;
  if (o.age < (o.warning ?? 0)) return;
  o.timer = (o.timer ?? 0) - dt;
  if (o.timer > 0) return;
  o.timer += CONFIG.plasmaLance.tickTime;
  const length = o.length ?? 0;
  for (const t of targetsOf(state, o.team)) {
    const along = (t.x - o.x) * dx + (t.y - o.y) * dy;
    const side = Math.abs((t.x - o.x) * dy - (t.y - o.y) * dx);
    if (along < -t.stats.radius || along > length + t.stats.radius || side > t.stats.radius + o.radius) continue;
    if (o.cuts) {
      const n = o.cuts.get(t) ?? 0;
      if (n >= CONFIG.elite.lanceHitsPerShip) continue;
      o.cuts.set(t, n + 1);
    }
    damageShip(state, t, o.damage);
    addEffect(state, 'vfx.plasma-hit', t.x, t.y, Math.random() * Math.PI * 2, 1, o.scale);
  }
}

function updateSplitBeam(state: GameState, o: SkillObj, dt: number) {
  const B = CONFIG.splitBeam;
  o.x += o.vx * dt;
  o.y += o.vy * dt;
  for (const t of targetsOf(state, o.team)) {
    // Ships it already hit (or split from) don't count, so new beams don't hit them again at once.
    if (o.hit!.has(t) || distSq(t.x, t.y, o.x, o.y) > (o.radius + t.stats.radius) ** 2) continue;
    damageShip(state, t, o.damage);
    addEffect(state, 'vfx.split-burst', t.x, t.y, Math.random() * Math.PI * 2, 1, o.scale);
    o.life = 0;
    if ((o.splits ?? 0) > 0) {
      const spread = (B.splitAngle * Math.PI) / 180;
      const range = B.splitRange * o.scale;
      for (const side of [-1, 1])
        addSplitBeam(state, o.team, o.tier, t.x, t.y, o.angle + side * spread, {
          damage: o.damage * B.falloff,
          range,
          splits: (o.splits ?? 0) - 1,
          scale: o.scale,
          // Each new beam remembers what this line of beams has hit.
          hit: new Set([...o.hit!, t]),
        });
      addSound(state, 'sfx.split-beam', t, o.tier, 0.4);
    }
    return;
  }
}

function updatePod(state: GameState, o: SkillObj, dt: number) {
  const P = CONFIG.laserPods;
  // Gliding out: slow evenly to a stop.
  if (o.age < (o.readyAt ?? 0)) {
    const left = (o.readyAt ?? 0) - o.age;
    o.vx *= left / (left + dt);
    o.vy *= left / (left + dt);
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    return;
  }
  // Pick a target: close to mid range, not one another pod already has (unless there aren't enough).
  if (!o.target || o.target.dead || o.target.merge) o.target = podTarget(state, o);
  const t = o.target;
  if (t) o.angle = Math.atan2(t.y - o.y, t.x - o.x);
  o.timer = (o.timer ?? 0) - dt;
  if (o.timer > 0 || !t) return;
  o.timer += P.shotInterval;
  // Aim where the target will be when the shot arrives.
  const travel = Math.hypot(t.x - o.x, t.y - o.y) / P.shotSpeed;
  const a = Math.atan2(t.y + t.vy * travel - o.y, t.x + t.vx * travel - o.x);
  state.bullets.push({
    team: o.team,
    sprite: 'projectile.pod-shot',
    tier: o.tier,
    x: o.x,
    y: o.y,
    vx: Math.cos(a) * P.shotSpeed,
    vy: Math.sin(a) * P.shotSpeed,
    life: (P.maxRange * 1.3 * o.scale) / P.shotSpeed,
    damage: o.damage,
    radius: 2 * o.scale,
    homing: 0,
    target: null,
  });
  addSound(state, 'sfx.pod-shot', o, o.tier, 0.5);
}

function podTarget(state: GameState, pod: SkillObj): Ship | null {
  const P = CONFIG.laserPods;
  const min = P.minRange * pod.scale;
  const max = P.maxRange * pod.scale;
  const taken = new Set(state.skillObjs.filter((o) => o.kind === 'pod' && o !== pod && o.target).map((o) => o.target));
  let best: Ship | null = null;
  let bestD = Infinity;
  let bestTaken = true;
  for (const s of visibleTargetsOf(state, pod.team)) {
    const d = Math.sqrt(distSq(s.x, s.y, pod.x, pod.y));
    if (d < min || d > max) continue;
    const isTaken = taken.has(s);
    if ((bestTaken && !isTaken) || (isTaken === bestTaken && d < bestD)) {
      best = s;
      bestD = d;
      bestTaken = isTaken;
    }
  }
  return best;
}

function updateWell(state: GameState, o: SkillObj, dt: number) {
  for (const s of state.ships) {
    if (s.team === o.team || s.dead || s.merge) continue;
    // The ship the player flies is never pulled (an elite's well only pulls your other ships).
    if (s === state.playerFleet.leader) continue;
    const dx = o.x - s.x;
    const dy = o.y - s.y;
    const d = Math.hypot(dx, dy);
    if (d > o.radius || d < 1) continue;
    // Strongest at the middle, nothing at the edge.
    const pull = o.damage * (1 - d / o.radius) ** 2;
    const step = Math.min(d, pull * dt);
    s.x += (dx / d) * step;
    s.y += (dy / d) * step;
  }
}

function updateScrambleWave(state: GameState, o: SkillObj, dt: number) {
  o.x += o.vx * dt;
  o.y += o.vy * dt;
  const dx = Math.cos(o.angle);
  const dy = Math.sin(o.angle);
  for (const s of state.ships) {
    if (s.team === o.team || s.dead || s.merge || o.hit!.has(s)) continue;
    // Never the ship the player flies: you always keep control.
    if (s === state.playerFleet.leader) continue;
    const along = (s.x - o.x) * dx + (s.y - o.y) * dy;
    const side = Math.abs((s.x - o.x) * dy - (s.y - o.y) * dx);
    if (Math.abs(along) > s.stats.radius + 12 || side > o.radius + s.stats.radius) continue;
    o.hit!.add(s);
    s.scrambled = Math.max(s.scrambled, o.damage);
  }
}

function updateThrown(state: GameState, o: SkillObj, dt: number) {
  const T = CONFIG.tractorBeam;
  if (!o.target || o.target.dead || o.target.merge) {
    // Its target is gone: the nearest visible enemy ahead of it.
    let best = Infinity;
    o.target = null;
    for (const s of visibleTargetsOf(state, o.team)) {
      const d = distSq(s.x, s.y, o.x, o.y);
      if (d < best) {
        best = d;
        o.target = s;
      }
    }
  }
  const t = o.target;
  const want = t ? Math.atan2(t.y - o.y, t.x - o.x) : o.angle;
  // While the beam holds it, it turns freely and speeds up; then it homes in more slowly.
  const holding = o.age < T.beamTime;
  o.angle += clamp(wrapAngle(want - o.angle), -(holding ? 20 : T.turnRate) * dt, (holding ? 20 : T.turnRate) * dt);
  const speed = T.speed * Math.min(1, o.age / T.beamTime);
  o.vx = Math.cos(o.angle) * speed;
  o.vy = Math.sin(o.angle) * speed;
  o.x += o.vx * dt;
  o.y += o.vy * dt;
  if (o.wreck) {
    o.wreck.x = o.x;
    o.wreck.y = o.y;
    o.wreck.angle += o.wreck.spin * 3 * dt;
  }
  for (const s of targetsOf(state, o.team)) {
    if (distSq(s.x, s.y, o.x, o.y) > (o.radius + s.stats.radius) ** 2) continue;
    damageShip(state, s, o.damage);
    // Enemies close by take part of it.
    const splash = T.splashRadius * o.scale;
    for (const n of targetsOf(state, o.team))
      if (n !== s && distSq(n.x, n.y, o.x, o.y) < (splash + n.stats.radius) ** 2) damageShip(state, n, o.damage * T.splash);
    addEffect(state, 'vfx.explosion', o.x, o.y, Math.random() * Math.PI * 2, o.tier);
    addSound(state, 'sfx.explosion', o, o.tier);
    o.life = 0;
    return;
  }
  // Breaks up harmlessly if it flies too long.
  if (o.age >= o.life) addEffect(state, 'vfx.hit', o.x, o.y, 0, o.tier);
}

/** An elite's scrap charge: warns with a ring, then blows up. */
function updateScrap(state: GameState, o: SkillObj) {
  if (o.age < o.life) return;
  blast(state, o.team, o.x, o.y, o.radius, o.damage);
  addSound(state, 'sfx.wrecksplosion', o, o.tier);
}

function updateWall(state: GameState, o: SkillObj, dt: number, c: Controls) {
  const F = CONFIG.forceWall;
  const pts = o.points!;
  if (o.drawing) {
    o.timer = (o.timer ?? 0) - dt;
    const owner = o.owner;
    // Still drawing: add the cursor's path, until the length or time runs out or the button is let go.
    if (owner && !owner.dead && c.defendHeld && o.timer > 0 && (o.budget ?? 0) > 0) {
      const last = pts[pts.length - 1];
      let d = Math.hypot(c.aimX - last.x, c.aimY - last.y);
      if (d >= F.step) {
        d = Math.min(d, o.budget ?? 0);
        const a = Math.atan2(c.aimY - last.y, c.aimX - last.x);
        pts.push({ x: last.x + Math.cos(a) * d, y: last.y + Math.sin(a) * d });
        o.budget = (o.budget ?? 0) - d;
      }
    } else finishWall(state, o);
  }
  blockAtWall(state, o, dt);
}

/** Let go early: the wall finishes itself along a circle around the ship, the way it was being drawn. */
function finishWall(state: GameState, o: SkillObj) {
  const F = CONFIG.forceWall;
  const pts = o.points!;
  const ship = o.owner;
  o.drawing = false;
  o.life = o.age + F.life;
  if (ship && o.skill) o.skill.timer = cooldownOf(state, o.skill);
  if (!ship || (o.budget ?? 0) < F.step) return;
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2] ?? { x: ship.x, y: ship.y };
  const r = Math.max(Math.hypot(last.x - ship.x, last.y - ship.y), 60 * ship.stats.size);
  // Which way round: the way the last bit of wall was going (counter-clockwise if it wasn't moving).
  const cross = (last.x - ship.x) * (last.y - prev.y) - (last.y - ship.y) * (last.x - prev.x);
  const dir = cross < 0 ? -1 : 1;
  let a = Math.atan2(last.y - ship.y, last.x - ship.x);
  const stepA = F.step / r;
  while ((o.budget ?? 0) >= F.step) {
    a += stepA * dir;
    pts.push({ x: ship.x + Math.cos(a) * r, y: ship.y + Math.sin(a) * r });
    o.budget = (o.budget ?? 0) - F.step;
  }
}

/** Enemy ships can't cross a wall (they slide along it); enemy shots and moving skill effects that reach it are stopped. */
function blockAtWall(state: GameState, o: SkillObj, dt: number) {
  const pts = o.points!;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    for (const s of state.ships) {
      if (s.team === o.team || s.dead || s.merge) continue;
      const q = closestOnSegment(s.x, s.y, a, b);
      const dx = s.x - q.x;
      const dy = s.y - q.y;
      const d = Math.hypot(dx, dy);
      const min = o.radius + s.stats.radius;
      if (d >= min) continue;
      // Push it back out to the side it's on, and stop it moving into the wall.
      const nx = d > 0.01 ? dx / d : -(b.y - a.y) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
      const ny = d > 0.01 ? dy / d : (b.x - a.x) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
      s.x = q.x + nx * min;
      s.y = q.y + ny * min;
      const into = s.vx * nx + s.vy * ny;
      if (into < 0) {
        s.vx -= into * nx;
        s.vy -= into * ny;
      }
    }
    for (const bl of state.bullets) {
      if (bl.team === o.team || bl.life <= 0) continue;
      if (!crossesWall(bl.x, bl.y, bl.x + bl.vx * dt, bl.y + bl.vy * dt, a, b, o.radius + bl.radius)) continue;
      bl.life = 0;
      wallHit(state, o, bl.x, bl.y);
    }
    for (const m of state.skillObjs) {
      if (m.team === o.team || m.age >= m.life || !STOPPED_BY_WALLS.has(m.kind)) continue;
      if (!crossesWall(m.x, m.y, m.x + m.vx * dt, m.y + m.vy * dt, a, b, o.radius + m.radius)) continue;
      m.life = 0;
      wallHit(state, o, m.x, m.y);
    }
  }
}

/** Moving skill effects a wall stops (an enemy's crescent, beam, ion ball or thrown scrap). */
const STOPPED_BY_WALLS = new Set<SkillObj['kind']>(['crescent', 'splitBeam', 'ionBall', 'thrown']);

function wallHit(state: GameState, o: SkillObj, x: number, y: number) {
  addEffect(state, 'vfx.force-wall-hit', x, y, 0, 1, o.scale);
  addSound(state, 'sfx.force-wall-hit', { x, y }, 1, 0.5);
}

/** The point of segment a–b closest to (x, y). */
function closestOnSegment(x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }) {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const len2 = ex * ex + ey * ey || 1;
  const t = clamp(((x - a.x) * ex + (y - a.y) * ey) / len2, 0, 1);
  return { x: a.x + ex * t, y: a.y + ey * t };
}

/** Whether something moving from (x0, y0) to (x1, y1) touches segment a–b (with this much thickness). */
function crossesWall(x0: number, y0: number, x1: number, y1: number, a: { x: number; y: number }, b: { x: number; y: number }, thick: number) {
  const q = closestOnSegment(x1, y1, a, b);
  if (distSq(x1, y1, q.x, q.y) < thick * thick) return true;
  // Or it passed right through between steps.
  const d = (x1 - x0) * (b.y - a.y) - (y1 - y0) * (b.x - a.x);
  if (d === 0) return false;
  const t = ((a.x - x0) * (b.y - a.y) - (a.y - y0) * (b.x - a.x)) / d;
  const u = ((a.x - x0) * (y1 - y0) - (a.y - y0) * (x1 - x0)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function updateHijackPulse(state: GameState, o: SkillObj) {
  const ship = o.owner;
  if (ship) {
    o.x = ship.x;
    o.y = ship.y;
  }
  o.radius = (o.length ?? 0) * Math.min(1, o.age / CONFIG.hijack.pulseTime);
  // Enemies the ring has reached, nearest first; each is taken over if it still fits in the value left.
  const reached = targetsOf(state, o.team)
    .filter((s) => !o.hit!.has(s) && distSq(s.x, s.y, o.x, o.y) < (o.radius + s.stats.radius) ** 2)
    .sort((a, b) => distSq(a.x, a.y, o.x, o.y) - distSq(b.x, b.y, o.x, o.y));
  for (const s of reached) {
    o.hit!.add(s);
    // Never elites, never the ship the player flies, never a ship already hijacked.
    if (s.elite || s === state.playerFleet.leader || s.hijacked > 0) continue;
    const v = tierValue(s.tier);
    if (v > (o.value ?? 0) || (o.left ?? Infinity) <= 0) continue;
    o.value = (o.value ?? 0) - v;
    o.left = (o.left ?? Infinity) - 1;
    hijackShip(state, s, o.duration ?? 0);
    addEffect(state, 'vfx.cloak', s.x, s.y, 0, 1, s.stats.size);
  }
}

// ---------- Elites ----------

/** Whether an elite should use one of these skills now, against `target` (d = distance, off = angle off its nose). */
export function eliteWantsMore(ship: Ship, sk: OwnedSkill, d: number, off: number): boolean {
  switch (sk.id) {
    case 'gatling':
      return off < 0.4 && d < CONFIG.gatling.range * rangeOf(ship) * 0.9;
    case 'crescent':
      return d < CONFIG.crescent.distance * ship.stats.size * 0.8;
    case 'arcImpulse':
      return d < CONFIG.arcImpulse.range * rangeOf(ship);
    case 'ionCloud':
      return d < CONFIG.ionCloud.distance * ship.stats.size * 1.3;
    case 'plasmaLance':
      return off < 0.3 && d < CONFIG.plasmaLance.length * ship.stats.size * sk.mods.size;
    case 'splitBeam':
      return off < 0.3 && d < CONFIG.splitBeam.range * rangeOf(ship) * 0.9;
    case 'laserPods':
      return d < CONFIG.laserPods.maxRange * ship.stats.size;
    case 'gravityWell':
      return d < 500;
    case 'scramble':
      return off < 0.4 && d < CONFIG.scramble.distance * ship.stats.size * 0.8;
    case 'wrecksplosion':
      return d < 500;
    case 'tractorBeam':
      return d < 600;
    case 'forceWall':
      return d < 600 && ship.hp < ship.stats.maxHp * 0.8;
    case 'cloak':
      return ship.hp < ship.stats.maxHp * 0.6;
    case 'hijack':
      return d < CONFIG.hijack.radius * ship.stats.size * 0.7;
    default:
      return false;
  }
}

/** Angle helper for elites (radians off the ship's nose). */
export const angleOff = (ship: Ship, x: number, y: number) => Math.abs(wrapAngle(Math.atan2(y - ship.y, x - ship.x) - ship.angle));
