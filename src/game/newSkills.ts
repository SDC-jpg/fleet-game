// The 2026-11-15 skills: Point Defense Cannons, Cannibalize and Time Dilation
// (right click), and the passives (always on, no button): Force Dash, Crisis
// Jump, Tech Scanner (shown by the HUD) and Long-Range Radar (drawn by Game.ts).
// Rules only, like world.ts: nothing is drawn here. Only you get these skills
// (elites never do: `elites: false` in SKILLS).

import { clamp, distSq, randRange, wrapAngle } from '../engine/math';
import { CONFIG, type SkillId } from './config';
import { modsOf, powerOf } from './skills';
import { addEffect, addSound, controlledShip, damageShip, type Bullet, type GameState, type OwnedSkill, type Ship } from './world';

/** Your copy of a skill, if you have it. */
export const ownedSkill = (state: GameState, id: SkillId) => state.skills.find((sk) => sk.id === id);

// ---------- Point Defense Cannons ----------

/** Where each cannon sits: either side of the flagship. */
export function pdcPositions(ship: Ship) {
  const off = ship.stats.radius * CONFIG.pdc.sideOffset;
  const px = -Math.sin(ship.angle) * off;
  const py = Math.cos(ship.angle) * off;
  return [
    { x: ship.x + px, y: ship.y + py },
    { x: ship.x - px, y: ship.y - py },
  ];
}

/** Enemy missiles still under power (spent ones tumble harmlessly). */
const liveEnemyMissiles = (state: GameState) => state.bullets.filter((b) => b.team === 'enemy' && b.homing > 0 && !b.spent && b.life > 0);

/**
 * The angle to fire at so a shot of speed `speed` from (x, y), also carried by
 * the shooter's velocity (vx, vy), meets a target moving in a straight line.
 * Falls back to aiming straight at it when it can't be caught.
 */
function leadAngle(x: number, y: number, vx: number, vy: number, t: Bullet, speed: number) {
  const px = t.x - x;
  const py = t.y - y;
  const rvx = t.vx - vx;
  const rvy = t.vy - vy;
  const a = rvx * rvx + rvy * rvy - speed * speed;
  const b = 2 * (px * rvx + py * rvy);
  const c = px * px + py * py;
  let time = -1;
  if (Math.abs(a) < 1e-6) time = b < 0 ? -c / b : -1;
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      const t1 = (-b - r) / (2 * a);
      const t2 = (-b + r) / (2 * a);
      time = Math.min(...[t1, t2].filter((v) => v > 0), Infinity);
      if (!isFinite(time)) time = -1;
    }
  }
  if (time <= 0) return Math.atan2(py, px);
  return Math.atan2(py + rvy * time, px + rvx * time);
}

/**
 * The cannons lock onto the incoming missile closest to the flagship (within
 * lock range), turn toward where it will be, and fire while it's inside their
 * firing arc. Shots start wide and tighten as the missile closes in. Firing
 * uses ammo; empty, they wait until CONFIG.pdc.restartAt is reloaded.
 */
export function updatePdc(state: GameState, dt: number) {
  const sk = ownedSkill(state, 'pdc');
  const ship = controlledShip(state);
  const P = CONFIG.pdc;
  const pdc = state.pdc;
  pdc.firing = false;
  if (!sk || !ship || ship.dead || ship.merge) return;
  const mods = modsOf(state, ship, sk);
  const range = P.range * mods.size;
  // Missiles further out (up to trackRange × the lock range) are tracked, so the cannons turn in time, but not fired at.
  const track = range * P.trackRange;

  // Keep the lock while the missile is alive and in range; otherwise lock onto the closest one.
  const inRange = (b: Bullet) => b.life > 0 && !b.spent && distSq(b.x, b.y, ship.x, ship.y) < track * track;
  if (!pdc.target || !inRange(pdc.target)) {
    let best: Bullet | null = null;
    let bestD = Infinity;
    for (const m of liveEnemyMissiles(state)) {
      const d = distSq(m.x, m.y, ship.x, ship.y);
      if (d < track * track && d < bestD) {
        best = m;
        bestD = d;
      }
    }
    pdc.target = best;
  }

  const turn = ((P.turnRate * Math.PI) / 180) * dt;
  const half = ((P.fireArc / 2) * Math.PI) / 180;
  const target = pdc.target;
  const firing = !!target && distSq(target.x, target.y, ship.x, ship.y) < range * range;
  const spots = pdcPositions(ship);
  let fired = false;
  spots.forEach((at, i) => {
    const c = pdc.cannons[i];
    c.timer = Math.max(0, c.timer - dt);
    // With nothing to shoot, the cannons face forward.
    const want = target ? leadAngle(at.x, at.y, ship.vx, ship.vy, target, P.shotSpeed) : ship.angle;
    c.angle += clamp(wrapAngle(want - c.angle), -turn, turn);
    if (!target || !firing || pdc.dry || c.timer > 0 || Math.abs(wrapAngle(want - c.angle)) > half) return;
    // Aim error: wide at the edge of the range, tight up close.
    const near = Math.sqrt(distSq(target.x, target.y, ship.x, ship.y)) / range;
    const spread = ((P.spreadNear + (P.spreadFar - P.spreadNear) * clamp(near, 0, 1)) * Math.PI) / 180;
    const a = c.angle + randRange(-spread, spread);
    state.bullets.push({
      team: 'player',
      sprite: 'projectile.pdc',
      tier: 1,
      x: at.x,
      y: at.y,
      vx: ship.vx + Math.cos(a) * P.shotSpeed,
      vy: ship.vy + Math.sin(a) * P.shotSpeed,
      life: P.shotLife,
      damage: 0,
      radius: P.shotRadius,
      homing: 0,
      target: null,
      source: 'pdc',
      interceptor: true,
    });
    c.timer += 1 / P.shotsPerSecond;
    fired = true;
    // A quiet rattle (not every shot, there are dozens).
    if (Math.random() < 0.25) addSound(state, 'sfx.pdc', at, 1, 0.35);
  });

  // Ammo: runs down while firing, reloads (twice as slowly by default) while not.
  if (fired) {
    pdc.firing = true;
    pdc.ammo = Math.max(0, pdc.ammo - dt / (P.ammoTime * mods.power));
    if (pdc.ammo <= 0) pdc.dry = true;
  } else pdc.ammo = Math.min(1, pdc.ammo + (dt * mods.rate) / P.reloadTime);
  if (pdc.dry && pdc.ammo >= P.restartAt) pdc.dry = false;
}

/** A PDC round meeting an enemy missile shoots it down (both are gone). Rounds never hit ships. */
export function interceptMissiles(state: GameState, round: Bullet) {
  for (const m of state.bullets) {
    if (m.team === round.team || m.homing <= 0 || m.spent || m.life <= 0) continue;
    const r = m.radius + round.radius;
    if (distSq(m.x, m.y, round.x, round.y) > r * r) continue;
    m.life = 0;
    round.life = 0;
    addEffect(state, 'vfx.missile-hit', m.x, m.y, Math.random() * Math.PI * 2, m.tier);
    addSound(state, 'sfx.missile-hit', m, m.tier, 0.6);
    state.stats.skillUses.pdcKills = (state.stats.skillUses.pdcKills ?? 0) + 1;
    return;
  }
}

// ---------- Cannibalize ----------

/** Break down one tier-1 ship of your fleet (the nearest) to repair the flagship. Stays ready if there's nothing to do. */
export function cannibalize(state: GameState, ship: Ship, sk: OwnedSkill) {
  if (ship.team !== 'player' || ship.hp >= ship.stats.maxHp - 1e-6) return false;
  const food = state.playerFleet.members
    .filter((s) => s !== ship && s.tier === 1 && !s.dead && !s.merge && !s.absorbed)
    .sort((a, b) => distSq(a.x, a.y, ship.x, ship.y) - distSq(b.x, b.y, ship.x, ship.y))[0];
  if (!food) return false;
  // It isn't destroyed (no explosion, not a loss): it's taken apart for parts.
  state.playerFleet.members = state.playerFleet.members.filter((s) => s !== food);
  state.ships = state.ships.filter((s) => s !== food);
  addEffect(state, 'vfx.cannibalize', food.x, food.y, 0, 1);
  const mods = modsOf(state, ship, sk);
  ship.hp = Math.min(ship.stats.maxHp, ship.hp + ship.stats.maxHp * CONFIG.cannibalize.repair * mods.power);
  addEffect(state, 'vfx.cannibalize', ship.x, ship.y, 0, ship.tier);
  addSound(state, 'sfx.cannibalize', ship, ship.tier);
  return true;
}

// ---------- Time Dilation ----------

/** Everything except your fleet slows down for a while (world.ts runs them on a slower clock). */
export function startTimeDilation(state: GameState, ship: Ship, sk: OwnedSkill) {
  if (ship.team !== 'player') return false;
  const mods = modsOf(state, ship, sk);
  state.timeDilation = Math.max(state.timeDilation, CONFIG.timeDilation.duration * mods.power);
  addEffect(state, 'vfx.time-dilation', ship.x, ship.y, 0, ship.tier);
  addSound(state, 'sfx.time-dilation', ship, 1, 1, true);
  return true;
}

// ---------- Force Dash (passive) ----------

/** While your fleet dashes, each enemy it passes through takes damage (once per dash). */
export function updateForceDash(state: GameState) {
  const sk = ownedSkill(state, 'forceDash');
  const fleet = state.playerFleet;
  const flagship = controlledShip(state);
  if (!sk || !flagship || fleet.dashTime <= 0) return;
  const F = CONFIG.forceDash;
  const mods = modsOf(state, flagship, sk);
  const hits = (fleet.dashHits ??= new Set());
  for (const mine of fleet.members) {
    if (mine.dead || mine.merge) continue;
    const reach = mine.stats.radius * F.reach * mods.size;
    for (const e of state.ships) {
      if (e.team === 'player' || e.dead || e.merge || hits.has(e)) continue;
      const r = reach + e.stats.radius;
      if (distSq(e.x, e.y, mine.x, mine.y) > r * r) continue;
      hits.add(e);
      damageShip(state, e, F.damage * powerOf(state, mine) * mods.power, 'forceDash');
      addEffect(state, 'vfx.hit', e.x, e.y, 0, mine.tier + 1);
      addSound(state, 'sfx.hit', e, mine.tier);
    }
  }
}

// ---------- Crisis Jump (passive) ----------

/**
 * Below a share of health, your whole fleet warps ahead: of several spots in
 * front, the one with the fewest enemies and enemy shots nearby. Then it
 * recharges (the skill's timer).
 */
export function updateCrisisJump(state: GameState) {
  const sk = ownedSkill(state, 'crisisJump');
  const ship = controlledShip(state);
  const J = CONFIG.crisisJump;
  if (!sk || !ship || ship.dead || ship.merge || sk.timer > 0) return;
  if (ship.hp > ship.stats.maxHp * J.healthBelow) return;
  const mods = modsOf(state, ship, sk);
  const dist = J.distance * ship.stats.size * mods.reach;
  // Ahead = where it's moving (or facing, if it's nearly still).
  const moving = Math.hypot(ship.vx, ship.vy) > 20;
  const ahead = moving ? Math.atan2(ship.vy, ship.vx) : ship.angle;
  const danger = (x: number, y: number) => {
    const r2 = J.dangerRadius * J.dangerRadius;
    let n = 0;
    for (const e of state.ships) if (e.team !== 'player' && !e.dead && distSq(e.x, e.y, x, y) < r2) n += e.elite ? 5 : 1;
    for (const b of state.bullets) if (b.team !== 'player' && distSq(b.x, b.y, x, y) < r2) n += 0.25;
    return n;
  };
  let best = { x: 0, y: 0, score: Infinity };
  for (let k = -3; k <= 3; k++) {
    const a = ahead + (((k / 3) * J.spreadDegrees) * Math.PI) / 180;
    const x = ship.x + Math.cos(a) * dist;
    const y = ship.y + Math.sin(a) * dist;
    // Straight ahead wins ties.
    const score = danger(x, y) + Math.abs(k) * 0.01;
    if (score < best.score) best = { x, y, score };
  }
  const dx = best.x - ship.x;
  const dy = best.y - ship.y;
  const dir = Math.atan2(dy, dx);
  // The whole fleet jumps together, keeping its formation (and the leader's path, which followers use).
  // Each ship warps out where it was and in where it lands, streaks pointing the way it jumped.
  for (const s of state.playerFleet.members) {
    addEffect(state, 'vfx.warp-out', s.x, s.y, dir, s.tier);
    s.x += dx;
    s.y += dy;
    addEffect(state, 'vfx.warp-in', s.x, s.y, dir, s.tier);
  }
  for (const p of state.playerFleet.trail) {
    p.x += dx;
    p.y += dy;
  }
  addSound(state, 'sfx.warp', ship, ship.tier, 1, true);
  sk.timer = J.cooldown / mods.rate;
  state.stats.skillUses.crisisJump = (state.stats.skillUses.crisisJump ?? 0) + 1;
}

/** Radar range in world pixels for a view this wide (Long-Range Radar). */
export function radarRange(state: GameState, viewWidth: number) {
  const sk = ownedSkill(state, 'radar');
  const ship = controlledShip(state);
  if (!sk || !ship) return 0;
  return (viewWidth / 2) * CONFIG.radar.rangeViews * modsOf(state, ship, sk).reach;
}
