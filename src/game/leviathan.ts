// The Leviathan (boss, first version): a head and a chain of body segments that follow exactly
// the path the head flew, like train cars on a track. It's one Ship (the head) with a body:
// one shared health pool, and shots hit it anywhere along the body (its hit circles, see
// hitShape.ts). For now it only flies: it circles its target and lunges at it now and then.
// Settings: CONFIG.leviathan. Art: boss.leviathan.* (drawn facing up), drawn in render.ts.

import { clamp, turnToward, wrapAngle } from '../engine/math';
import { CONFIG } from './config';
import type { HitCircle } from './artLayout';
import type { GameState, Ship } from './world';
import { findNearestEnemy } from './world';

export type PieceKind = 'head' | 'segment' | 'antepenultimate' | 'penultimate' | 'tail';

/** One piece of the body, where it is now. */
export interface LeviathanPiece {
  kind: PieceKind;
  /** Distance behind the head along its path. */
  behind: number;
  x: number;
  y: number;
  angle: number;
}

export interface LeviathanBody {
  /** Head first, tail last. */
  pieces: LeviathanPiece[];
  /** Where the head has been: x, y pairs, oldest first (the newest is the head itself). */
  trail: number[];
  /** How fast it's turning (radians per second, smoothed; + = clockwise on screen = right turn). */
  turning: number;
  /** Which head shows: 0 = top view, 1 = side view turning right, −1 = turning left. */
  view: -1 | 0 | 1;
  /** Seconds the turn has been pointing toward a different view (see sideViewHold). */
  viewTimer: number;
  /** Seconds until the next lunge, and seconds left of the current one. */
  lungeIn: number;
  lunging: number;
  /** Which way it circles its target (1 or −1). */
  circleDir: number;
}

/** The art for each piece (manifest names). */
export const PIECE_SPRITES: Record<PieceKind, string> = {
  head: 'boss.leviathan.head',
  segment: 'boss.leviathan.segment',
  antepenultimate: 'boss.leviathan.segment-antepenultimate',
  penultimate: 'boss.leviathan.segment-penultimate',
  tail: 'boss.leviathan.tail',
};
export const SIDE_HEAD_SPRITE = 'boss.leviathan.head-side';

/** A new body lying straight behind a head at (x, y) facing `angle`. */
export function makeLeviathanBody(x: number, y: number, angle: number): LeviathanBody {
  const L = CONFIG.leviathan;
  const kinds: PieceKind[] = ['head', ...Array<PieceKind>(L.segments).fill('segment'), 'antepenultimate', 'penultimate', 'tail'];
  let behind = 0;
  const pieces = kinds.map((kind, i) => {
    if (i === 1) behind += L.headGap;
    else if (kind === 'tail') behind += L.tailGap;
    else if (i > 1) behind += L.spacing;
    return { kind, behind, x, y, angle };
  });
  // A straight path behind it to start on.
  const length = behind + 10;
  const trail = [x - Math.cos(angle) * length, y - Math.sin(angle) * length, x, y];
  const body: LeviathanBody = {
    pieces,
    trail,
    turning: 0,
    view: 0,
    viewTimer: 0,
    lungeIn: L.lungeEvery,
    lunging: 0,
    circleDir: Math.random() < 0.5 ? 1 : -1,
  };
  placePieces(body, x, y);
  return body;
}

/**
 * Its flying (called in place of the usual enemy AI): it always swims forward, turning at a
 * limited rate. It circles its target, and every few seconds lunges straight at it.
 */
export function updateLeviathanAI(state: GameState, ship: Ship, dt: number) {
  const L = CONFIG.leviathan;
  const body = ship.leviathan!;
  if (ship.frozen > 0) return;
  const target = findNearestEnemy(state, ship, Infinity);
  let want = ship.angle;
  let speed = L.speed;
  let turnRate = L.turnRate;
  body.lungeIn -= dt;
  if (body.lunging > 0) body.lunging -= dt;
  else if (body.lungeIn <= 0 && target) {
    body.lunging = L.lungeTime;
    body.lungeIn = L.lungeEvery;
  }
  if (target) {
    const dx = target.x - ship.x;
    const dy = target.y - ship.y;
    const d = Math.hypot(dx, dy);
    const toward = Math.atan2(dy, dx);
    if (body.lunging > 0) {
      want = toward;
      speed = L.lungeSpeed;
      turnRate = L.lungeTurnRate;
    } else {
      // Far away: straight in. At the circling distance: sideways (around it). Closer: veers away a little.
      const off = (Math.PI / 2) * clamp(2 - d / L.circleDistance, 0, 1.3);
      want = toward + off * body.circleDir;
    }
  }
  const before = ship.angle;
  ship.angle = turnToward(ship.angle, want, turnRate * dt);
  // Speed eases between cruising and lunging.
  const now = Math.hypot(ship.vx, ship.vy);
  const v = now + clamp(speed - now, -L.lungeSpeed * dt, L.lungeSpeed * dt);
  ship.vx = Math.cos(ship.angle) * v;
  ship.vy = Math.sin(ship.angle) * v;
  ship.thrust = 'move';
  // How fast it turns, smoothed, picks the head's view (top or side, with a short hold so it doesn't flicker).
  const rate = dt > 0 ? wrapAngle(ship.angle - before) / dt : 0;
  body.turning += (rate - body.turning) * Math.min(1, dt * 12);
  const wantView = Math.abs(body.turning) > L.sideViewTurn ? (body.turning > 0 ? 1 : -1) : 0;
  if (wantView === body.view) body.viewTimer = 0;
  else if ((body.viewTimer += dt) >= L.sideViewHold) {
    body.view = wantView;
    body.viewTimer = 0;
  }
}

/** After the head moved: remember its path, and put every piece on it. */
export function updateLeviathanBody(ship: Ship) {
  const body = ship.leviathan!;
  const t = body.trail;
  const lx = t[t.length - 2];
  const ly = t[t.length - 1];
  // A new point every couple of pixels.
  if (Math.hypot(ship.x - lx, ship.y - ly) >= 2) t.push(ship.x, ship.y);
  placePieces(body, ship.x, ship.y);
  // Forget the path behind the tail.
  const need = body.pieces[body.pieces.length - 1].behind + 20;
  let length = Math.hypot(ship.x - t[t.length - 2], ship.y - t[t.length - 1]);
  for (let i = t.length - 4; i >= 0; i -= 2) {
    length += Math.hypot(t[i + 2] - t[i], t[i + 3] - t[i + 1]);
    if (length > need && i > 0) {
      t.splice(0, i);
      break;
    }
  }
}

/** Each piece at its distance behind the head along the path, facing along it. */
function placePieces(body: LeviathanBody, hx: number, hy: number) {
  const t = body.trail;
  // Walk back from the head: (ax, ay) the near end of the current stretch, (bx, by) the far end.
  let ax = hx;
  let ay = hy;
  let i = t.length - 2;
  let walked = 0;
  for (const p of body.pieces) {
    while (i >= 0) {
      const bx = t[i];
      const by = t[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (walked + len >= p.behind && len > 0) {
        const f = (p.behind - walked) / len;
        p.x = ax + (bx - ax) * f;
        p.y = ay + (by - ay) * f;
        // It faces from the far end toward the near end (forward along the path).
        p.angle = Math.atan2(ay - by, ax - bx);
        break;
      }
      walked += len;
      ax = bx;
      ay = by;
      i -= 2;
    }
    if (i < 0) {
      // Path ran out (shouldn't happen): stack it on the last point.
      p.x = ax;
      p.y = ay;
    }
  }
  // The head faces where it's flying (set by updateLeviathanAI), not along the old path.
  body.pieces[0].x = hx;
  body.pieces[0].y = hy;
}

/** Its hit circles (world positions): one per piece. */
export function leviathanCircles(ship: Ship): HitCircle[] {
  const R = CONFIG.leviathan.hitRadius;
  return ship.leviathan!.pieces.map((p) => ({ x: p.x, y: p.y, r: R[p.kind] }));
}
