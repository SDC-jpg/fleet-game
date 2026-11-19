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
import { addSound, controlledShip, damageShip, findNearestEnemy } from './world';
import { rayHitsShip } from './hitShape';

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
  /** Its charged beam in progress, or null; and seconds until it may start the next one. */
  attack: LeviathanAttack | null;
  beamIn: number;
}

/** The charged beam in progress (CONFIG.leviathan.beam). */
export interface LeviathanAttack {
  /** Turning to get your flagship to its side, charging (mouth open, ball growing), or firing. */
  phase: 'aim' | 'charge' | 'fire';
  /** Seconds in this phase. */
  t: number;
  /** Which side its head looks and the beam goes: 1 = its right, −1 = its left. */
  side: 1 | -1;
  /** The push on its head from firing (pixels per second, fading out). */
  recoil: number;
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
/** The side head with its mouth open (charging and firing its beam). */
export const MOUTH_OPEN_HEAD_SPRITE = 'boss.leviathan.head-side-mouth-open';

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
  // Between the fangs of the open-mouth side head (pixel 125, 85 with its pivot at 80, 140); the beam goes along its nose.
  mouth: { x: 55, y: 45, angle: 0 },
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
    mouth: { ...LEVIATHAN_DEFAULTS.mouth, ...own.mouth },
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
    attack: null,
    beamIn: CONFIG.leviathan.beam.firstDelay,
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
  stepView(body, (level * side) as HeadView, dt);
}

/** Move the head's view one step at a time toward `wantView` (the first step after a short hold, the next ones quickly). */
function stepView(body: LeviathanBody, wantView: HeadView, dt: number) {
  const C = CONFIG.leviathan;
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
  const flagship = controlledShip(state);
  const watched = flagship && flagship.team !== ship.team && !flagship.dead ? flagship : null;
  ship.thrust = 'move';
  // Its charged beam takes over while it lasts.
  if (updateBeamAttack(state, ship, body, watched, dt)) return;
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
  lookToward(body, ship, watched, dt);
}

// ---------- The charged beam (CONFIG.leviathan.beam) ----------

/** Where its mouth is and which way the beam points (along its nose), for its head at (x, y) facing `angle`, its side head looking to `side`. */
export function beamOrigin(body: LeviathanBody, head: { x: number; y: number; angle: number }, side: number) {
  const m = body.layout.mouth;
  const k = body.pieces[0]?.scale ?? 1;
  const out = head.angle + (side * Math.PI) / 2;
  return {
    x: head.x + (Math.cos(head.angle) * m.x + Math.cos(out) * m.y) * k,
    y: head.y + (Math.sin(head.angle) * m.x + Math.sin(out) * m.y) * k,
    angle: head.angle + (side * m.angle * Math.PI) / 180,
  };
}

/** How thick the beam is now (1 = normal): thicker the moment it fires, thinning out at the end; 0 when not firing. */
export function beamThickness(a: LeviathanAttack | null) {
  if (!a || a.phase !== 'fire') return 0;
  const B = CONFIG.leviathan.beam;
  if (a.t < B.burstTime) return B.burstScale + (1 - B.burstScale) * (a.t / B.burstTime);
  if (a.t > B.fireTime - B.fadeTime) return Math.max(0, (B.fireTime - a.t) / B.fadeTime);
  return 1;
}

/** Start a beam (the game, and ShipArt's preview), looking to `side`; `charging` skips the aiming. */
export function startBeam(body: LeviathanBody, side: 1 | -1, charging = false) {
  body.attack = { phase: charging ? 'charge' : 'aim', t: 0, side, recoil: 0 };
}

/**
 * Its timing, shared with ShipArt: the head turns fully to the side, charges, fires (with a push on the
 * head), then stops. Returns what just happened ('charge', 'fire', 'end') for sounds and screen shake,
 * and how far the recoil moved its head this step. Aiming ends in the game (when it's lined up).
 */
export function advanceBeam(body: LeviathanBody, head: { angle: number }, dt: number) {
  const B = CONFIG.leviathan.beam;
  const a = body.attack;
  if (!a) return { event: null, dx: 0, dy: 0 };
  a.t += dt;
  stepView(body, (2 * a.side) as HeadView, dt);
  let event: 'fire' | 'end' | null = null;
  if (a.phase === 'charge' && a.t >= B.chargeTime) {
    a.phase = 'fire';
    a.t = 0;
    a.recoil = B.recoil;
    event = 'fire';
  } else if (a.phase === 'fire' && a.t >= B.fireTime) {
    body.attack = null;
    body.beamIn = B.every;
    return { event: 'end' as const, dx: 0, dy: 0 };
  }
  // Recoil pushes the head back against the beam.
  const back = head.angle + (a.side * body.layout.mouth.angle * Math.PI) / 180 + Math.PI;
  const push = a.recoil * dt;
  a.recoil *= Math.exp(-B.recoilFade * dt);
  return { event, dx: Math.cos(back) * push, dy: Math.sin(back) * push };
}

/** The beam in the game: start it when it's due, aim, follow your flagship slowly, and hurt what it touches. Returns true while it's on. */
function updateBeamAttack(state: GameState, ship: Ship, body: LeviathanBody, flagship: Ship | null, dt: number) {
  const C = CONFIG.leviathan;
  const B = C.beam;
  if (!body.attack) {
    body.beamIn -= dt;
    if (body.beamIn > 0 || !flagship || Math.hypot(flagship.x - ship.x, flagship.y - ship.y) > B.range) return false;
    // Its head turns fully to the side it already looks (or toward your flagship), while its nose swings onto your flagship.
    const toward = wrapAngle(Math.atan2(flagship.y - ship.y, flagship.x - ship.x) - ship.angle) >= 0 ? 1 : -1;
    startBeam(body, body.view !== 0 ? (Math.sign(body.view) as 1 | -1) : toward);
  }
  const a = body.attack!;
  // Your flagship is gone while it's still turning: give up (it tries again later).
  if (!flagship && a.phase === 'aim') {
    body.attack = null;
    body.beamIn = B.every;
    return false;
  }
  // Turn the whole head so its mouth points at your flagship: freely while aiming, then only slowly (outrunnable).
  const o = beamOrigin(body, ship, a.side);
  let want = ship.angle;
  let turnRate = C.turnRate;
  if (flagship) {
    const err = wrapAngle(Math.atan2(flagship.y - o.y, flagship.x - o.x) - o.angle);
    if (a.phase === 'aim') {
      want = ship.angle + err;
      // Charge once its nose is on your flagship and its head has turned fully to the side (or it ran out of time).
      const lined = Math.abs(err) < (B.aimTolerance * Math.PI) / 180 && body.view === 2 * a.side;
      if ((lined && a.t > 0.3) || a.t >= B.aimTime) {
        a.phase = 'charge';
        a.t = 0;
        addSound(state, 'sfx.leviathan-charge', o, 1, 1, true);
      }
    } else {
      const sweep = (B.trackSpeed / Math.max(60, Math.hypot(flagship.x - o.x, flagship.y - o.y))) * dt;
      want = ship.angle + clamp(err, -sweep, sweep);
      turnRate = 1000;
    }
  }
  swimLeviathan(body, ship, want, B.moveSpeed, turnRate, dt);
  if (a.phase === 'aim') {
    a.t += dt;
    stepView(body, (2 * a.side) as HeadView, dt);
    return true;
  }
  const step = advanceBeam(body, ship, dt);
  ship.x += step.dx;
  ship.y += step.dy;
  if (step.event === 'fire') state.shake = { time: B.shakeTime, strength: B.shake };
  // Everything of the other side it touches burns (shields first).
  const thick = beamThickness(body.attack);
  if (thick > 0) {
    const f = beamOrigin(body, ship, a.side);
    const dx = Math.cos(f.angle);
    const dy = Math.sin(f.angle);
    for (const s of state.ships) {
      if (s.team === ship.team || s.dead || s.merge) continue;
      const hit = rayHitsShip(s, f.x, f.y, dx, dy, (B.width / 2) * thick);
      if (hit !== null && hit <= state.beamReach) damageShip(state, s, s.stats.maxHp * B.damagePerSecond * dt, 'leviathan-beam');
    }
  }
  return true;
}

/** After the head moved to (x, y): remember its path, and put every piece on it. */
export function followHead(body: LeviathanBody, x: number, y: number, angle: number) {
  const t = body.trail;
  // Pushed backward (the beam's recoil): take back the end of the path instead of adding a reversed bit,
  // so the body slides back along it like a train reversing (a kink would ripple down every segment).
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  while (t.length > 4 && (t[t.length - 2] - x) * fx + (t[t.length - 1] - y) * fy > 0) t.length -= 2;
  // A new point every couple of pixels.
  if (Math.hypot(x - t[t.length - 2], y - t[t.length - 1]) >= 2) t.push(x, y);
  placePieces(body, x, y, angle);
  // Forget the path behind the tail.
  // (A spare stretch, so a push backward still finds path behind the tail.)
  const need = body.pieces[body.pieces.length - 1].behind + 80;
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
