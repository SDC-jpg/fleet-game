// The Leviathan's death (CONFIG.leviathan.death): the final blow slows time and zooms in a little
// (Game.ts, like your last ship's), then purple explosions consume its pieces one after another,
// spreading out from the one hit, while pulses of light run along the body and shockwaves race
// out. One last huge shockwave, and it's gone (then world.ts gives its XP and item).

import { randRange } from '../engine/math';
import { CONFIG } from './config';
import { type LeviathanBody } from './leviathan';
import { addEffect, addSound, controlledShip, type GameState, type Ship } from './world';

/** Its death in progress. */
export interface LeviathanDying {
  t: number;
  /** The piece the final blow hit (explosions spread out from it). */
  from: number;
  /** Explosions still to come per piece; and pieces already consumed (not drawn any more). */
  blasts: number[];
  gone: boolean[];
  nextPulse: number;
  nextShock: number;
  /** When the last piece was consumed (−1 = not yet), and whether it's all over. */
  lastAt: number;
  done: boolean;
}

/** The final blow: start dying (its energy balls burst; its attacks stop). */
export function startLeviathanDeath(state: GameState, ship: Ship) {
  const body = ship.leviathan!;
  const at = controlledShip(state) ?? ship;
  let from = 0;
  let best = Infinity;
  body.pieces.forEach((p, i) => {
    const d = (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
    if (d < best) {
      best = d;
      from = i;
    }
  });
  if (body.lastHit !== null) from = body.lastHit;
  body.attack = null;
  body.ram = null;
  body.dying = {
    t: 0,
    from,
    blasts: body.pieces.map(() => CONFIG.leviathan.death.blasts),
    gone: body.pieces.map(() => false),
    nextPulse: 0,
    nextShock: 0,
    lastAt: -1,
    done: false,
  };
  state.bossFinal = { ship, ready: false };
  for (const o of state.orbs) if (o.owner === ship) addEffect(state, 'boss.leviathan.orb-pulse', o.x, o.y, 0, 1, 1.2);
  const p = body.pieces[from];
  addEffect(state, 'boss.leviathan.shockwave', p.x, p.y, 0, 1, CONFIG.leviathan.death.shockScale);
  addSound(state, 'sfx.leviathan-roar', p, 1, 1, true);
}

/** When a piece starts to explode (seconds into the death). */
const startOf = (d: LeviathanDying, i: number) => Math.abs(i - d.from) * CONFIG.leviathan.death.spread;

/** Each step while it dies. */
export function updateLeviathanDeath(state: GameState, ship: Ship, dt: number) {
  const D = CONFIG.leviathan.death;
  const body = ship.leviathan!;
  const d = body.dying!;
  d.t += dt;
  // It drifts to a stop.
  const keep = Math.max(0, 1 - 1.5 * dt);
  ship.vx *= keep;
  ship.vy *= keep;
  state.shake = { time: CONFIG.death.shakeTime, strength: D.shake };
  const n = body.pieces.length;
  // Each piece: a few purple explosions over blastTime, then it's consumed.
  body.pieces.forEach((p, i) => {
    if (d.gone[i]) return;
    const start = startOf(d, i);
    if (d.t < start) return;
    const due = Math.min(D.blasts, Math.floor(((d.t - start) / D.blastTime) * D.blasts) + 1);
    while (D.blasts - d.blasts[i] < due) {
      d.blasts[i]--;
      const r = body.layout.hitRadius[p.kind] * p.scale;
      const a = Math.random() * Math.PI * 2;
      const k = Math.random() * r * 0.8;
      addEffect(state, 'boss.leviathan.explosion', p.x + Math.cos(a) * k, p.y + Math.sin(a) * k, Math.random() * Math.PI * 2, 1, randRange(D.blastScale[0], D.blastScale[1]));
      addSound(state, 'sfx.explosion', p, 3, 0.8);
      body.flash[i] = 1;
    }
    if (d.t >= start + D.blastTime) d.gone[i] = true;
  });
  // Pulses of light run along what's left of the body, from the piece hit outward.
  if (d.t >= d.nextPulse) {
    d.nextPulse = d.t + D.pulseEvery;
    for (let i = 0; i < n; i++) if (!d.gone[i]) body.flashQueue.push({ piece: i, strength: 0.85, delay: Math.abs(i - d.from) * D.pulseDelay });
  }
  // Shockwaves from exploding pieces.
  if (d.t >= d.nextShock) {
    d.nextShock = d.t + D.shockEvery;
    const burning = body.pieces.filter((_, i) => !d.gone[i] && d.t >= startOf(d, i));
    const p = burning[Math.floor(Math.random() * burning.length)];
    if (p) addEffect(state, 'boss.leviathan.shockwave', p.x, p.y, 0, 1, D.shockScale * randRange(0.8, 1.2));
  }
  // All consumed: one last huge shockwave, then it's over.
  if (d.lastAt < 0 && d.gone.every(Boolean)) {
    d.lastAt = d.t;
    const mid = body.pieces[d.from];
    addEffect(state, 'boss.leviathan.shockwave', mid.x, mid.y, 0, 1, D.finalShockScale);
    addEffect(state, 'boss.leviathan.explosion', mid.x, mid.y, 0, 1, D.blastScale[1] * 2);
    addSound(state, 'sfx.flagship-explosion', mid, 1, 1, true);
  }
  if (d.lastAt >= 0 && d.t >= d.lastAt + D.endDelay) d.done = true;
}

/** Is this piece already consumed by its death (not drawn)? */
export const pieceGone = (body: LeviathanBody, i: number) => !!body.dying?.gone[i];
