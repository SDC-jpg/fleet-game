// The Leviathan's other attacks (docs/LEVIATHAN-ATTACKS.md): energy balls, wounds (blood and hit
// flashes) and parasites. Its swimming, body hits, ram and beam are in leviathan.ts. Numbers:
// CONFIG.leviathan.orbs / wounds / parasites. Art: boss.leviathan.* (purple placeholders).
// It's a beast: its balls and blood hurt ships of either side (never itself or its parasites).

import { recordPieceHit, type HitPoint } from './damage';
import { clamp, randRange, wrapAngle } from '../engine/math';
import { CONFIG } from './config';
import { flashPiece, type LeviathanBody } from './leviathan';
import { pointHitsShip } from './hitShape';
import { addEffect, addSound, controlledShip, damageShip, spawnParasite, type GameState, type Ship } from './world';

/** An energy ball (CONFIG.leviathan.orbs). */
export interface Orb {
  /** The Leviathan that let it go (it vanishes when that one dies). */
  owner: Ship;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds until its next pulse. */
  pulseIn: number;
  /** Its own wander timing. */
  phase: number;
  age: number;
  /** Its spot in the loose cloud around the Leviathan's middle (angle, distance), and which way that spot circles (1 or −1). */
  homeAngle: number;
  homeDistance: number;
  homeTurn: number;
}

/** A blood shot from a wound (CONFIG.leviathan.wounds). */
export interface Blood {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
}

/** A parasite (CONFIG.leviathan.parasites): latched onto a ship of yours, or flying (stunned for a while after being shaken off). */
export interface ParasiteState {
  host: Ship | null;
  /** Where on its host it holds on (in the host's own frame: x forward, y right). */
  ox: number;
  oy: number;
  /** Its angle relative to its host's. */
  oa: number;
  stunned: number;
}

/** Ships a Leviathan's attacks never hurt: itself and its parasites. */
const spared = (s: Ship) => !!s.leviathan || !!s.parasite || s.dead || s.merge !== null || s.absorbed;

// ---------- Energy balls ----------

/** Each step, for each Leviathan: let go of a ball every few seconds of combat. */
export function updateOrbSpawning(state: GameState, ship: Ship, body: LeviathanBody, dt: number) {
  const O = CONFIG.leviathan.orbs;
  const flagship = controlledShip(state);
  if (!flagship || flagship.team === ship.team || Math.hypot(flagship.x - ship.x, flagship.y - ship.y) > O.combatRange) return;
  body.orbIn -= dt;
  if (body.orbIn > 0) return;
  body.orbIn = O.every;
  if (state.orbs.filter((o) => o.owner === ship).length >= O.max) return;
  // From a piece somewhere along its middle, which flashes.
  const n = body.pieces.length;
  const i = Math.min(n - 1, Math.max(1, Math.floor(randRange(0.2, 0.7) * n)));
  const p = body.pieces[i];
  flashPiece(body, i, CONFIG.leviathan.flash.wound * 0.6);
  state.orbs.push({
    owner: ship,
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    pulseIn: O.pulseEvery,
    phase: Math.random() * Math.PI * 2,
    age: 0,
    homeAngle: Math.random() * Math.PI * 2,
    // Spread evenly over the cloud's area (not bunched in the middle).
    homeDistance: Math.sqrt(O.cloud[0] ** 2 + Math.random() * (O.cloud[1] ** 2 - O.cloud[0] ** 2)),
    homeTurn: Math.random() < 0.5 ? 1 : -1,
  });
  addSound(state, 'sfx.leviathan-orb', p, 1);
}

/**
 * Balls keep to a loose cloud around their Leviathan (each its own spot, slowly circling), so the
 * cloud grows denser as the fight goes on; a ball homes in on any ship of yours that comes near it,
 * wandering a little. They pulse, and vanish when their Leviathan dies.
 */
function updateOrbs(state: GameState, dt: number) {
  const O = CONFIG.leviathan.orbs;
  state.orbs = state.orbs.filter((o) => !o.owner.dead && state.ships.includes(o.owner));
  for (const o of state.orbs) {
    o.age += dt;
    const wander = O.wander * Math.sin(o.age * O.wanderSpeed * Math.PI * 2 + o.phase);
    const body = o.owner.leviathan;
    const mid = body ? body.pieces[Math.floor(body.pieces.length / 2)] : o.owner;
    // Your nearest ship within reach (only while the ball is within its leash of the Leviathan).
    let prey: Ship | null = null;
    let best = O.attractRange ** 2;
    const leashed = (o.x - mid.x) ** 2 + (o.y - mid.y) ** 2 > O.leash ** 2;
    if (!leashed) for (const s of state.playerFleet.members) {
      if (s.dead || s.merge || s.absorbed) continue;
      const d = (s.x - o.x) ** 2 + (s.y - o.y) ** 2;
      if (d < best) {
        best = d;
        prey = s;
      }
    }
    let wantVx: number;
    let wantVy: number;
    if (prey) {
      // Homing in, its heading wandering either side.
      const a = Math.atan2(prey.y - o.y, prey.x - o.x) + wander;
      wantVx = Math.cos(a) * O.speed;
      wantVy = Math.sin(a) * O.speed;
    } else {
      // Back to its spot in the cloud around the Leviathan's middle (fast if it's fallen behind).
      o.homeAngle += O.cloudTurn * o.homeTurn * dt;
      const r = o.homeDistance * (1 + 0.15 * Math.sin(o.age * 0.7 + o.phase));
      const dx = mid.x + Math.cos(o.homeAngle) * r - o.x;
      const dy = mid.y + Math.sin(o.homeAngle) * r - o.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = Math.min(O.followSpeed, d * 3);
      wantVx = (dx / d) * v;
      wantVy = (dy / d) * v;
    }
    const k = Math.min(1, O.steer * dt);
    o.vx += (wantVx - o.vx) * k;
    o.vy += (wantVy - o.vy) * k;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    o.pulseIn -= dt;
    if (o.pulseIn > 0) continue;
    o.pulseIn += O.pulseEvery;
    addEffect(state, 'boss.leviathan.orb-pulse', o.x, o.y, 0, 1, O.radius / 70);
    addSound(state, 'sfx.leviathan-pulse', o, 1);
    for (const s of state.ships) {
      if (spared(s)) continue;
      const r = O.radius + s.stats.radius;
      if ((s.x - o.x) ** 2 + (s.y - o.y) ** 2 < r * r) damageShip(state, s, s.stats.maxHp * O.damage, 'leviathan-orb');
    }
  }
}

/** A ball's look now: how much it has swollen for its next pulse (0 = normal, 1 = about to pulse). */
export function orbTell(o: Orb) {
  return clamp(1 - o.pulseIn / CONFIG.leviathan.orbs.pulseTell, 0, 1);
}

// ---------- Wounds: hit flashes, blood and parasites ----------

/**
 * A Leviathan was hurt (from damageShip; `at` = where the blow landed, if known). Its piece there
 * flashes; each 1/count of its health lost is a wound: blood, a rippling flash, and parasites
 * (not from its head or tail).
 */
export function onLeviathanHit(state: GameState, ship: Ship, at: HitPoint | undefined, amount = 0, source = 'gun') {
  const body = ship.leviathan!;
  const W = CONFIG.leviathan.wounds;
  // The piece hit: nearest to where it landed (or, not known, nearest to your flagship).
  const from = at ?? controlledShip(state) ?? ship;
  let piece = 0;
  let best = Infinity;
  body.pieces.forEach((p, i) => {
    const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
    if (d < best) {
      best = d;
      piece = i;
    }
  });
  flashPiece(body, piece, CONFIG.leviathan.flash.hit);
  body.lastHit = piece;
  // A mark where it landed (damage.ts; drawn in shipDamage.ts).
  recordPieceHit(ship, body.pieces[piece], piece, amount, source, at);
  if (ship.dead) return;
  const lost = ship.stats.maxHp - Math.max(0, ship.hp);
  const step = ship.stats.maxHp / W.count;
  while (body.wounds < W.count - 1 && lost >= (body.wounds + 1) * step) {
    body.wounds++;
    const p = body.pieces[piece];
    // Where it landed, or (not known) the piece's edge toward the attacker.
    const a = Math.atan2(from.y - p.y, from.x - p.x);
    const r = body.layout.hitRadius[p.kind] * p.scale;
    const x = at?.x ?? p.x + Math.cos(a) * r;
    const y = at?.y ?? p.y + Math.sin(a) * r;
    wound(state, body, piece, x, y);
    // A big glowing gash where its blood burst out.
    recordPieceHit(ship, p, piece, 0, 'leviathan-wound', { x, y }, 'wound');
  }
}

function wound(state: GameState, body: LeviathanBody, piece: number, x: number, y: number) {
  const W = CONFIG.leviathan.wounds;
  flashPiece(body, piece, CONFIG.leviathan.flash.wound, true);
  addSound(state, 'sfx.leviathan-wound', { x, y }, 1, 1, true);
  for (let i = 0; i < W.bloodShots; i++) {
    const a = (i / W.bloodShots) * Math.PI * 2 + Math.random() * 0.3;
    const v = W.bloodSpeed * (1 + randRange(-W.bloodSpeedRandom, W.bloodSpeedRandom));
    state.blood.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: W.bloodLife * randRange(0.8, 1.1), age: 0 });
  }
  // Its head and tail bleed, but parasites only come from its body.
  if (piece === 0 || piece === body.pieces.length - 1) return;
  const P = CONFIG.leviathan.parasites;
  const alive = state.ships.filter((s) => s.parasite && !s.dead).length;
  const count = Math.min(P.max - alive, Math.round(randRange(W.parasitesMin, W.parasitesMax)));
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const p = spawnParasite(state, x, y, a);
    const v = P.burstSpeed * randRange(0.6, 1.2);
    p.vx = Math.cos(a) * v;
    p.vy = Math.sin(a) * v;
  }
}

/** Blood shots fly, slow a little, and splash on the first ship they hit (either side). */
function updateBlood(state: GameState, dt: number) {
  const W = CONFIG.leviathan.wounds;
  for (const b of state.blood) {
    b.age += dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const keep = Math.max(0, 1 - W.bloodDrag * dt);
    b.vx *= keep;
    b.vy *= keep;
    for (const s of state.ships) {
      if (spared(s) || !pointHitsShip(s, b.x, b.y, W.bloodRadius)) continue;
      // It bursts: every ship within the blast takes the damage (either side).
      for (const t of state.ships) {
        if (spared(t)) continue;
        const r = W.bloodBlastRadius + t.stats.radius;
        if ((t.x - b.x) ** 2 + (t.y - b.y) ** 2 < r * r) damageShip(state, t, t.stats.maxHp * W.bloodDamage, 'leviathan-blood', b);
      }
      addEffect(state, 'boss.leviathan.explosion', b.x, b.y, Math.random() * Math.PI * 2, 1, (W.bloodBlastRadius * 2) / 64);
      addSound(state, 'sfx.missile-hit', b, 1, 0.6);
      b.age = b.life;
      break;
    }
  }
  state.blood = state.blood.filter((b) => b.age < b.life);
}

// ---------- Parasites ----------

/** A parasite's flying (its own fleet's leader, in place of the enemy AI): at your nearest ship, latching on when it touches it. */
export function updateParasite(state: GameState, ship: Ship, dt: number) {
  const P = CONFIG.leviathan.parasites;
  const ps = ship.parasite!;
  ship.thrust = 'move';
  if (ps.host) {
    if (ps.host.dead || ps.host.team !== 'player' || ps.host.merge) ps.host = null;
    else {
      // Riding along (its place is set after everything moved: see stickParasites).
      ship.vx = ps.host.vx;
      ship.vy = ps.host.vy;
      return;
    }
  }
  if (ps.stunned > 0) {
    ps.stunned -= dt;
    ship.angle += 8 * dt;
    const keep = Math.max(0, 1 - 2 * dt);
    ship.vx *= keep;
    ship.vy *= keep;
    return;
  }
  let target: Ship | null = null;
  let best = Infinity;
  for (const s of state.playerFleet.members) {
    if (s.dead || s.merge || s.absorbed) continue;
    const d = (s.x - ship.x) ** 2 + (s.y - ship.y) ** 2;
    if (d < best) {
      best = d;
      target = s;
    }
  }
  if (!target) return;
  const dx = target.x - ship.x;
  const dy = target.y - ship.y;
  const d = Math.sqrt(best);
  ship.angle = Math.atan2(dy, dx);
  const wantVx = (dx / (d || 1)) * P.speed;
  const wantVy = (dy / (d || 1)) * P.speed;
  const ddx = wantVx - ship.vx;
  const ddy = wantVy - ship.vy;
  const dl = Math.hypot(ddx, ddy);
  const step = Math.min(dl, P.accel * dt);
  if (dl > 0) {
    ship.vx += (ddx / dl) * step;
    ship.vy += (ddy / dl) * step;
  }
  // Touching: latch on, somewhere on its hull (on the side it came from).
  if (d < target.stats.radius + ship.stats.radius) {
    ps.host = target;
    const rel = Math.atan2(ship.y - target.y, ship.x - target.x) - target.angle;
    const r = target.stats.radius * 0.75;
    ps.ox = Math.cos(rel) * r;
    ps.oy = Math.sin(rel) * r;
    // Facing in, toward the middle of its host.
    ps.oa = wrapAngle(rel + Math.PI);
    addSound(state, 'sfx.parasite-latch', ship, 1);
  }
}

/** How much latched parasites slow your fleet now (1 = not at all). */
export function parasiteSlow(state: GameState) {
  const P = CONFIG.leviathan.parasites;
  let n = 0;
  for (const s of state.ships) if (s.parasite?.host && !s.dead) n++;
  return 1 - Math.min(P.maxSlow, n * P.slowPerParasite);
}

/** After everything moved: latched parasites sit on their hosts. A dash of your fleet shakes them all off. */
function stickParasites(state: GameState) {
  const P = CONFIG.leviathan.parasites;
  const dashing = state.playerFleet.dashTime > 0;
  const shake = dashing && !state.parasitesShaken;
  state.parasitesShaken = dashing;
  let shook = false;
  for (const s of state.ships) {
    const ps = s.parasite;
    if (!ps?.host || s.dead) continue;
    const h = ps.host;
    const c = Math.cos(h.angle);
    const sn = Math.sin(h.angle);
    s.x = h.x + ps.ox * c - ps.oy * sn;
    s.y = h.y + ps.ox * sn + ps.oy * c;
    s.angle = h.angle + ps.oa;
    if (shake) {
      // Flung off outward, tumbling for a while.
      const a = Math.atan2(s.y - h.y, s.x - h.x);
      s.vx = h.vx * 0.3 + Math.cos(a) * P.shakeSpeed;
      s.vy = h.vy * 0.3 + Math.sin(a) * P.shakeSpeed;
      ps.host = null;
      ps.stunned = P.stunTime;
      shook = true;
    }
  }
  if (shook) addSound(state, 'sfx.parasite-shake', controlledShip(state) ?? { x: 0, y: 0 }, 1, 1, true);
}

/** Each step, after ships moved: balls, blood and parasites. */
export function updateLeviathanAttacks(state: GameState, dt: number) {
  updateOrbs(state, dt);
  updateBlood(state, dt);
  stickParasites(state);
}
