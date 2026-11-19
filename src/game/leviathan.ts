// The Leviathan (boss, first version): a head and a chain of body segments that follow exactly
// the path the head flew, like train cars on a track. It's one Ship (the head) with a body:
// one shared health pool, and shots hit it anywhere along the body (its hit circles, see
// hitShape.ts). For now it only flies: it circles its target and lunges at it now and then.
// How it behaves: CONFIG.leviathan. How its body is put together: art.json `bosses.leviathan`
// (ShipArt → Bosses), defaults below. Art: boss.leviathan.* (drawn facing up), drawn in render.ts.
// The body code doesn't need the game, so ShipArt's preview uses it too.

import { clamp, turnToward, wrapAngle } from '../engine/math';
import { CONFIG } from './config';
import type { ArtLayoutsFile, HitCircle, LeviathanBulge, LeviathanLayout, LeviathanPieceKind } from './artLayout';
import type { GameState, Ship } from './world';
import { findNearestEnemy } from './world';

export type PieceKind = LeviathanPieceKind;

/** One piece of the body, where it is now. */
export interface LeviathanPiece {
  kind: PieceKind;
  /** Distance behind the head along its path. */
  behind: number;
  /** How big it's drawn (and its hit circle), from the bulges: 1 = normal. */
  scale: number;
  x: number;
  y: number;
  angle: number;
}

export interface LeviathanBody {
  /** How it's put together (from art.json). */
  layout: LeviathanLayout;
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

/** The art for each piece (manifest names; each image's anchor is the piece's pivot). */
export const PIECE_SPRITES: Record<PieceKind, string> = {
  head: 'boss.leviathan.head',
  segment: 'boss.leviathan.segment',
  antepenultimate: 'boss.leviathan.segment-antepenultimate',
  penultimate: 'boss.leviathan.segment-penultimate',
  tail: 'boss.leviathan.tail',
};
export const SIDE_HEAD_SPRITE = 'boss.leviathan.head-side';

/** Used for anything art.json doesn't set. */
export const LEVIATHAN_DEFAULTS: LeviathanLayout = {
  segments: 16,
  headGap: 22,
  spacing: 15,
  tailGap: 18,
  sideViewForRightTurns: true,
  hitRadius: { head: 34, segment: 32, antepenultimate: 30, penultimate: 26, tail: 22 },
  bulges: [],
};

/**
 * How much of a bulge a piece gets, `t` of the way out over its falloff (0 = the bulge's own
 * piece, 1 = just past the last one that gets any): 1 down to 0 along a cubic Bezier curve.
 * curve 0 = a straight fade; toward +1 it stays strong then drops; toward −1 it drops fast then trails.
 */
export function falloffWeight(t: number, curve: number) {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  // The fade's shape y(t) from 0 to 1 (x = t), with its two middle control points raised or lowered.
  const c = clamp(curve, -1, 1);
  const a = 1 / 3 - c / 3;
  const b = 2 / 3 - c / 3;
  const u = 1 - t;
  return 1 - (3 * u * u * t * a + 3 * u * t * t * b + t * t * t);
}

/** Each piece's size from the bulges (several multiply). */
export function bulgeScales(bulges: LeviathanBulge[], count: number): number[] {
  const scales = Array<number>(count).fill(1);
  for (const b of bulges) {
    const reach = Math.max(0, b.falloff) + 1;
    for (let i = 0; i < count; i++) {
      const w = falloffWeight(Math.abs(i - b.piece) / reach, b.curve);
      if (w > 0) scales[i] *= 1 + (b.scale - 1) * w;
    }
  }
  return scales.map((s) => Math.max(0.05, s));
}

/** The layout in this art.json data, with the defaults filled in. */
export function leviathanLayout(data: ArtLayoutsFile | null | undefined): LeviathanLayout {
  const own = data?.bosses?.leviathan ?? {};
  return { ...LEVIATHAN_DEFAULTS, ...own, hitRadius: { ...LEVIATHAN_DEFAULTS.hitRadius, ...own.hitRadius }, bulges: own.bulges ?? [] };
}

/** The layout the game uses (Game.ts sets it once art.json is loaded). */
let gameLayout = LEVIATHAN_DEFAULTS;
export function setLeviathanLayout(data: ArtLayoutsFile | null) {
  gameLayout = leviathanLayout(data);
}
export const currentLeviathanLayout = () => gameLayout;

/** The pieces, head to tail, at their distances behind the head. */
function makePieces(L: LeviathanLayout): LeviathanPiece[] {
  const kinds: PieceKind[] = ['head', ...Array<PieceKind>(Math.max(0, Math.round(L.segments))).fill('segment'), 'antepenultimate', 'penultimate', 'tail'];
  const scales = bulgeScales(L.bulges, kinds.length);
  let behind = 0;
  return kinds.map((kind, i) => {
    if (i === 1) behind += L.headGap;
    else if (kind === 'tail') behind += L.tailGap;
    else if (i > 1) behind += L.spacing;
    return { kind, behind, scale: scales[i], x: 0, y: 0, angle: 0 };
  });
}

/** A new body lying straight behind a head at (x, y) facing `angle`. */
export function makeLeviathanBody(x: number, y: number, angle: number, L = gameLayout): LeviathanBody {
  const body: LeviathanBody = {
    layout: L,
    pieces: makePieces(L),
    trail: [x - Math.cos(angle), y - Math.sin(angle), x, y],
    turning: 0,
    view: 0,
    viewTimer: 0,
    lungeIn: CONFIG.leviathan.lungeEvery,
    lunging: 0,
    circleDir: Math.random() < 0.5 ? 1 : -1,
  };
  placePieces(body, x, y, angle);
  return body;
}

/** Put a body together again with another layout (ShipArt, while editing), keeping its path. */
export function relayLeviathan(body: LeviathanBody, L: LeviathanLayout, x: number, y: number, angle: number) {
  body.layout = L;
  body.pieces = makePieces(L);
  placePieces(body, x, y, angle);
}

/**
 * Turn the head toward `want` (at most turnRate × dt) and fly that way, easing toward `speed`;
 * then pick the head's view from how fast it's turning (with a short hold so it doesn't flicker).
 */
export function swimLeviathan(body: LeviathanBody, head: { angle: number; vx: number; vy: number }, want: number, speed: number, turnRate: number, dt: number) {
  const C = CONFIG.leviathan;
  const before = head.angle;
  head.angle = turnToward(head.angle, want, turnRate * dt);
  const now = Math.hypot(head.vx, head.vy);
  const v = now + clamp(speed - now, -C.lungeSpeed * dt, C.lungeSpeed * dt);
  head.vx = Math.cos(head.angle) * v;
  head.vy = Math.sin(head.angle) * v;
  const rate = dt > 0 ? wrapAngle(head.angle - before) / dt : 0;
  body.turning += (rate - body.turning) * Math.min(1, dt * 12);
  const wantView = Math.abs(body.turning) > C.sideViewTurn ? (body.turning > 0 ? 1 : -1) : 0;
  if (wantView === body.view) body.viewTimer = 0;
  else if ((body.viewTimer += dt) >= C.sideViewHold) {
    body.view = wantView;
    body.viewTimer = 0;
  }
}

/**
 * Its flying in the game (called in place of the usual enemy AI): it always swims forward,
 * turning at a limited rate. It circles its target, and every few seconds lunges straight at it.
 */
export function updateLeviathanAI(state: GameState, ship: Ship, dt: number) {
  const C = CONFIG.leviathan;
  const body = ship.leviathan!;
  if (ship.frozen > 0) return;
  const target = findNearestEnemy(state, ship, Infinity);
  let want = ship.angle;
  let speed = C.speed;
  let turnRate = C.turnRate;
  body.lungeIn -= dt;
  if (body.lunging > 0) body.lunging -= dt;
  else if (body.lungeIn <= 0 && target) {
    body.lunging = C.lungeTime;
    body.lungeIn = C.lungeEvery;
  }
  if (target) {
    const dx = target.x - ship.x;
    const dy = target.y - ship.y;
    const d = Math.hypot(dx, dy);
    const toward = Math.atan2(dy, dx);
    if (body.lunging > 0) {
      want = toward;
      speed = C.lungeSpeed;
      turnRate = C.lungeTurnRate;
    } else {
      // Far away: straight in. At the circling distance: sideways (around it). Closer: veers away a little.
      const off = (Math.PI / 2) * clamp(2 - d / C.circleDistance, 0, 1.3);
      want = toward + off * body.circleDir;
    }
  }
  swimLeviathan(body, ship, want, speed, turnRate, dt);
  ship.thrust = 'move';
}

/** After the head moved to (x, y): remember its path, and put every piece on it. */
export function followHead(body: LeviathanBody, x: number, y: number, angle: number) {
  const t = body.trail;
  // A new point every couple of pixels.
  if (Math.hypot(x - t[t.length - 2], y - t[t.length - 1]) >= 2) t.push(x, y);
  placePieces(body, x, y, angle);
  // Forget the path behind the tail.
  const need = body.pieces[body.pieces.length - 1].behind + 20;
  let length = Math.hypot(x - t[t.length - 2], y - t[t.length - 1]);
  for (let i = t.length - 4; i >= 0; i -= 2) {
    length += Math.hypot(t[i + 2] - t[i], t[i + 3] - t[i + 1]);
    if (length > need && i > 0) {
      t.splice(0, i);
      break;
    }
  }
}

/** Each piece at its distance behind the head along the path, facing along it. */
function placePieces(body: LeviathanBody, hx: number, hy: number, headAngle: number) {
  const t = body.trail;
  // Walk back from the head: (ax, ay) the near end of the current stretch, (bx, by) the far end.
  let ax = hx;
  let ay = hy;
  let dir = headAngle;
  let i = t.length - 2;
  let walked = 0;
  for (const p of body.pieces) {
    let placed = false;
    while (i >= 0) {
      const bx = t[i];
      const by = t[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len > 0) dir = Math.atan2(ay - by, ax - bx);
      if (walked + len >= p.behind && len > 0) {
        const f = (p.behind - walked) / len;
        p.x = ax + (bx - ax) * f;
        p.y = ay + (by - ay) * f;
        // It faces from the far end toward the near end (forward along the path).
        p.angle = dir;
        placed = true;
        break;
      }
      walked += len;
      ax = bx;
      ay = by;
      i -= 2;
    }
    // Past the end of the path (just spawned, or more segments added): straight on behind it.
    if (!placed) {
      const more = p.behind - walked;
      p.x = ax - Math.cos(dir) * more;
      p.y = ay - Math.sin(dir) * more;
      p.angle = dir;
    }
  }
  // The head faces where it's flying, not along the old path.
  body.pieces[0].angle = headAngle;
}

/** Its hit circles (world positions): one per piece. */
export function leviathanCircles(body: LeviathanBody): HitCircle[] {
  const R = body.layout.hitRadius;
  return body.pieces.map((p) => ({ x: p.x, y: p.y, r: R[p.kind] * p.scale }));
}
