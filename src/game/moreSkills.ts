// The newer skills (docs/SKILLS.md): Gatling Laser, Crescent Strike, Arc
// Impulse, Ion Cloud, Plasma Lance... Most of them leave "skill objects" in the
// world (a crescent in flight, a cloud's balls, a lance on a ship) that live
// for a moment; updateSkillObjects moves them and does their damage, and
// render.ts draws them by kind. Like world.ts, nothing is drawn here.

import { distSq, randRange, wrapAngle } from '../engine/math';
import { CONFIG } from './config';
import { modsOf, powerOf } from './skills';
import { addEffect, addSound, damageShip, type Controls, type GameState, type OwnedSkill, type Ship, type Team } from './world';

/** Something a skill left in the world for a moment. */
export interface SkillObj {
  kind: 'gatling' | 'crescent' | 'arcChain' | 'arcBolt' | 'ionBall' | 'lance';
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
  /** Arc bolt: where it starts (it's drawn from here to x, y). Lance: its length. */
  fromX?: number;
  fromY?: number;
  length?: number;
}

/** Enemies of `team` that can be hit right now. */
const targetsOf = (state: GameState, team: Team) => state.ships.filter((s) => s.team !== team && !s.dead && !s.merge);

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
  for (const s of targetsOf(state, ship.team)) {
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

// ---------- Updating what they left in the world ----------

export function updateSkillObjects(state: GameState, dt: number) {
  for (const o of state.skillObjs) {
    o.age += dt;
    UPDATE[o.kind](state, o, dt);
  }
  state.skillObjs = state.skillObjs.filter((o) => o.age < o.life);
}

const UPDATE: Record<SkillObj['kind'], (state: GameState, o: SkillObj, dt: number) => void> = {
  gatling: updateGatling,
  crescent: updateCrescent,
  arcChain: updateArcChain,
  arcBolt: () => {},
  ionBall: updateIonBall,
  lance: updateLance,
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
  for (const s of targetsOf(state, o.team)) {
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
    default:
      return false;
  }
}

/** Angle helper for elites (radians off the ship's nose). */
export const angleOff = (ship: Ship, x: number, y: number) => Math.abs(wrapAngle(Math.atan2(y - ship.y, x - ship.x) - ship.angle));
