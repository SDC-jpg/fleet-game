// The Leviathan (boss, first version): a head and a chain of body segments that follow exactly
// the path the head flew, like train cars on a track. It's one Ship (the head) with a body:
// one shared health pool, and shots hit it anywhere along the body (its hit circles, see
// hitShape.ts). For now it only flies: it circles its target and lunges at it now and then.
// How it behaves: CONFIG.leviathan. How its body is put together: art.json `bosses.leviathan`
// (ShipArt → Bosses), defaults below. Art: boss.leviathan.* (drawn facing up), drawn in render.ts.
// The body code doesn't need the game, so ShipArt's preview uses it too.

import { clamp, turnToward, wrapAngle } from '../engine/math';
import { CONFIG } from './config';
import { DEFAULT_FIN_IMAGE, type ArtLayoutsFile, type HitCircle, type LeviathanBulge, type LeviathanFin, type LeviathanLayout, type LeviathanPieceKind } from './artLayout';
import type { GameState, Ship } from './world';
import { controlledShip, findNearestEnemy } from './world';

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
  /** Which head shows: 0 = top view, 1 = half-side view looking right, 2 = side view looking right; negative = looking left (see lookToward). */
  view: HeadView;
  /** Seconds the turn has been pointing toward a different view (see sideViewHold). */
  viewTimer: number;
  /** The head is partway through a change of view (top → half-side → side), so the next step comes sooner (viewStepTime). */
  viewStepping: boolean;
  /** Seconds until the next lunge, and seconds left of the current one. */
  lungeIn: number;
  lunging: number;
  /** Which way it circles its target (1 or −1). */
  circleDir: number;
  /** Each fin's joints (same order as layout.fins). */
  fins: FinState[];
  /** Seconds since it appeared (for the fins' sway). */
  time: number;
}

/** A fin's bones: where each one points now (world radians, root first; null = not placed yet), and its own sway timing. */
export interface FinState {
  angles: number[] | null;
  phase: number;
}

/** A pair of fins, one on each side (the left one mirrored). */
const finPair = (piece: number, x: number, y: number, angle: number, scale: number): LeviathanFin[] => [
  { piece, x, y, angle, scale, flip: false, front: false },
  { piece, x, y: -y, angle: -angle, scale, flip: true, front: false },
];

/** The art for each piece (manifest names; each image's anchor is the piece's pivot). */
export const PIECE_SPRITES: Record<PieceKind, string> = {
  head: 'boss.leviathan.head',
  segment: 'boss.leviathan.segment',
  antepenultimate: 'boss.leviathan.segment-antepenultimate',
  penultimate: 'boss.leviathan.segment-penultimate',
  tail: 'boss.leviathan.tail',
};
export const SIDE_HEAD_SPRITE = 'boss.leviathan.head-side';
/** The head halfway between the top and side views (gentle turns, and on the way to the side view). */
export const HALF_SIDE_HEAD_SPRITE = 'boss.leviathan.head-halfside';

export type HeadView = -2 | -1 | 0 | 1 | 2;

/** Used for anything art.json doesn't set. */
export const LEVIATHAN_DEFAULTS: LeviathanLayout = {
  segments: 16,
  headGap: 22,
  spacing: 15,
  tailGap: 18,
  sideViewForRightTurns: true,
  hitRadius: { head: 34, segment: 32, antepenultimate: 30, penultimate: 26, tail: 22 },
  bulges: [],
  // Until fins are placed in ShipArt, defaultFins puts a first pass on the body (see leviathanLayout).
  fins: [],
  finImages: { [DEFAULT_FIN_IMAGE]: { x: 11, y: 15 } },
  gradients: [],
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

/**
 * A first pass of fins (after the user's mockup), for a body with this many segments: swept-back
 * pairs a little behind the head, and a spray on the last three pieces. Sizes are small since a
 * fin also grows with its piece's bulge. Used until fins are placed in ShipArt.
 */
export function defaultFins(segments: number): LeviathanFin[] {
  const n = Math.max(0, Math.round(segments));
  const tail = n + 3;
  const front = (share: number) => Math.max(1, Math.min(n, Math.round(n * share)));
  return [
    ...finPair(front(0.12), -4, 28, 145, 0.8),
    ...finPair(front(0.24), 0, 28, 150, 0.85),
    ...finPair(front(0.36), 0, 26, 155, 0.75),
    ...finPair(tail - 2, 0, 24, 150, 0.7),
    ...finPair(tail - 1, 0, 22, 158, 0.85),
    ...finPair(tail, -24, 14, 168, 0.9),
  ];
}

/** The layout in this art.json data, with the defaults filled in. */
export function leviathanLayout(data: ArtLayoutsFile | null | undefined): LeviathanLayout {
  const own = data?.bosses?.leviathan ?? {};
  return {
    ...LEVIATHAN_DEFAULTS,
    ...own,
    hitRadius: { ...LEVIATHAN_DEFAULTS.hitRadius, ...own.hitRadius },
    bulges: own.bulges ?? [],
    fins: own.fins ?? defaultFins(own.segments ?? LEVIATHAN_DEFAULTS.segments),
    finImages: { ...LEVIATHAN_DEFAULTS.finImages, ...own.finImages },
    gradients: own.gradients ?? [],
  };
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
    viewStepping: false,
    lungeIn: CONFIG.leviathan.lungeEvery,
    lunging: 0,
    circleDir: Math.random() < 0.5 ? 1 : -1,
    fins: L.fins.map(newFinState),
    time: 0,
  };
  placePieces(body, x, y, angle);
  return body;
}

/** Put a body together again with another layout (ShipArt, while editing), keeping its path. */
export function relayLeviathan(body: LeviathanBody, L: LeviathanLayout, x: number, y: number, angle: number) {
  body.layout = L;
  body.pieces = makePieces(L);
  // Fins keep their joints (so they don't snap) where there's still a fin.
  body.fins = L.fins.map((_, i) => body.fins[i] ?? newFinState());
  placePieces(body, x, y, angle);
}

const newFinState = (): FinState => ({ angles: null, phase: Math.random() * Math.PI * 2 });

/** The piece a fin is on (its number kept within the body). */
export const finPiece = (body: LeviathanBody, fin: LeviathanFin) => body.pieces[clamp(Math.round(fin.piece), 0, body.pieces.length - 1)];

/** Where a fin's root is in the world, and the way it points at rest (world radians). */
export function finRoot(body: LeviathanBody, fin: LeviathanFin) {
  const p = finPiece(body, fin);
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  const x = fin.x * p.scale;
  const y = fin.y * p.scale;
  return { x: p.x + x * c - y * s, y: p.y + x * s + y * c, angle: p.angle + (fin.angle * Math.PI) / 180, scale: fin.scale * p.scale };
}

/**
 * Move the fins' joints: the root bone is fixed to its piece; each next bone turns toward the one
 * before it, more slowly toward the tip, so the fin trails behind the body's turns, with a gentle
 * sway that grows toward the tip.
 */
export function updateFins(body: LeviathanBody, dt: number) {
  const C = CONFIG.leviathan;
  body.time += dt;
  const n = Math.max(1, Math.round(C.finJoints) + 1);
  body.layout.fins.forEach((fin, i) => {
    const st = body.fins[i];
    if (!st) return;
    const base = finRoot(body, fin).angle;
    if (!st.angles || st.angles.length !== n) st.angles = Array<number>(n).fill(base);
    const a = st.angles;
    a[0] = base;
    for (let k = 1; k < n; k++) {
      const along = k / (n - 1);
      const sway = ((C.finSway * Math.PI) / 180) * along * Math.sin(body.time * Math.PI * 2 * C.finSwaySpeed + st.phase - k * 0.9);
      const target = a[k - 1] + sway;
      const stiffness = C.finStiffness + (C.finTipStiffness - C.finStiffness) * along;
      a[k] += wrapAngle(target - a[k]) * (1 - Math.exp(-dt * stiffness));
    }
  });
}

/**
 * Turn the head toward `want` (at most turnRate × dt) and fly that way, easing toward `speed`.
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
}

/**
 * The head keeps its eye on a point (the flagship in the game): straight (top view) while it's
 * about in front, half turned while it's ahead but off to one side, fully turned (side view) while
 * it's more to the side or behind. null = nothing to watch: straight. The head moves one view at
 * a time (top → half-side → side, and back), with a short hold so it doesn't flicker.
 */
export function lookToward(body: LeviathanBody, head: { x: number; y: number; angle: number }, at: { x: number; y: number } | null, dt: number) {
  const C = CONFIG.leviathan;
  // How far off its heading the point is, in degrees (+ = to its right on screen).
  const off = at ? (wrapAngle(Math.atan2(at.y - head.y, at.x - head.x) - head.angle) * 180) / Math.PI : 0;
  const level = Math.abs(off) > C.sideViewAngle ? 2 : Math.abs(off) > C.frontViewAngle ? 1 : 0;
  // Right behind it, the head keeps looking over the shoulder it already uses (no flipping side to side).
  const side = level === 2 && Math.abs(off) > C.behindAngle && body.view !== 0 ? Math.sign(body.view) : Math.sign(off);
  const wantView = (level * side) as HeadView;
  if (wantView === body.view) {
    body.viewTimer = 0;
    body.viewStepping = false;
  } else if ((body.viewTimer += dt) >= (body.viewStepping ? C.viewStepTime : C.sideViewHold)) {
    body.view = (body.view + Math.sign(wantView - body.view)) as HeadView;
    body.viewTimer = 0;
    body.viewStepping = body.view !== wantView;
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
  // Its head keeps watching your flagship.
  const flagship = controlledShip(state);
  lookToward(body, ship, flagship && flagship.team !== ship.team && !flagship.dead ? flagship : null, dt);
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
