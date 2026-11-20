// Ship volume (prototype, 2026-11-20): ships bank (roll along their length) and pitch (tip along
// their width) a little, like a 3D hull instead of a flat sheet.
//
// 1. A height for every solid pixel, guessed from the outline: deep inside the silhouette is tall,
//    near its edge is low (the distance to the nearest empty pixel), shaped by a few settings
//    (VolumeShape, per ship in art.json). So a hull is thick along its spine, its wings thin.
// 2. To tilt it, every pixel (split into a few sub-points, so nothing tears) is a point at its
//    height, turned by the bank and pitch, and seen from straight above again; the highest point
//    wins each output pixel. Raised parts slide sideways against the wings, which reads as volume.
// 3. Light (optional): the side tilting toward the light gets lighter, the other darker, but only
//    by stepping to another colour of the same ramp in the ship's own palette (never new colours).
//
// Tilted copies are made once per frame, shape and angle step, and kept (like RotSprite copies).
// The art's own pixels at bank 0 and pitch 0 come out unchanged.

import type { Frame, Sprite } from './assets';

/** A ship's guessed 3D shape (art.json `volume`, set in ShipArt). */
export interface VolumeShape {
  /** How tall the hull is: 1 = as tall as half its thickest width. */
  height: number;
  /** Cross-section: 0 = a wedge (straight slopes), 1 = round. */
  round: number;
  /** Above 1 the edges flatten and the spine stands out; below 1 it's fuller, like a pillow. */
  spine: number;
}

export const DEFAULT_VOLUME: VolumeShape = { height: 0.6, round: 0.7, spine: 1.2 };

/** Tilt angles are snapped to steps this size (radians) and their copies kept. */
export const TILT_STEP = Math.PI / 90;

/** Where the light comes from (screen: x right, y down, z toward you): above, from the top left. */
const LIGHT = (() => {
  const v = [-0.35, -0.45, 0.82];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();
/** How far a full turn toward the light moves a colour along its ramp (in lightness, 0–1). */
const LIGHT_STRENGTH = 0.3;
/** Sub-points per pixel along each side (3 × 3), so tilted pixels leave no gaps. */
const SUB = 3;

// ---------- 1. The height shape ----------

interface Heights {
  w: number;
  h: number;
  /** Height of each pixel (0 where empty). */
  z: Float32Array;
  /** The pixel colours (RGBA), read once. */
  rgba: Uint8ClampedArray;
}

const heightCache = new WeakMap<CanvasImageSource, Map<string, Heights>>();

function readFrame(f: Frame) {
  const c = document.createElement('canvas');
  c.width = f.w;
  c.height = f.h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(f.image, f.sx, f.sy, f.w, f.h, 0, 0, f.w, f.h);
  return g.getImageData(0, 0, f.w, f.h).data;
}

/** Each solid pixel's height, from its distance to the outline and the shape settings. */
function heightsOf(f: Frame, shape: VolumeShape): Heights {
  let byKey = heightCache.get(f.image);
  if (!byKey) heightCache.set(f.image, (byKey = new Map()));
  const key = `${f.sx},${f.sy},${f.w},${f.h}|${shape.height},${shape.round},${shape.spine}`;
  const done = byKey.get(key);
  if (done) return done;
  const { w, h } = f;
  const rgba = readFrame(f);
  // Distance to the nearest empty pixel (outside the image counts as empty): two chamfer passes.
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = rgba[i * 4 + 3] > 0 ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  const D = 1;
  const DD = Math.SQRT2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + D, at(x, y - 1) + D, at(x - 1, y - 1) + DD, at(x + 1, y - 1) + DD);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + D, at(x, y + 1) + D, at(x + 1, y + 1) + DD, at(x - 1, y + 1) + DD);
    }
  let max = 0;
  for (let i = 0; i < w * h; i++) max = Math.max(max, d[i]);
  const z = new Float32Array(w * h);
  if (max > 0)
    for (let i = 0; i < w * h; i++) {
      if (!d[i]) continue;
      // Edge pixels start at half a pixel up (so even a one-pixel wing has some body).
      const t = Math.min(1, (d[i] - 0.5) / max);
      const roundT = Math.sqrt(Math.max(0, 1 - (1 - t) ** 2));
      const profile = t + (roundT - t) * shape.round;
      z[i] = shape.height * max * profile ** shape.spine;
    }
  const out = { w, h, z, rgba };
  byKey.set(key, out);
  return out;
}

/** Height at a point of the image (pixel units, from its top left), 0 outside it. */
function heightAt(H: Heights, x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= H.w || iy >= H.h) return 0;
  return H.z[iy * H.w + ix];
}

/** Smooth height between pixel centres (for the sub-points). */
function heightSmooth(H: Heights, x: number, y: number) {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const z = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= H.w || yy >= H.h ? 0 : H.z[yy * H.w + xx]);
  const top = z(x0, y0) * (1 - tx) + z(x0 + 1, y0) * tx;
  const bottom = z(x0, y0 + 1) * (1 - tx) + z(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

// ---------- 2. Turning a point ----------

/**
 * A point of the ship (x forward, y to its right, as drawn facing right; z up toward you) after
 * banking (`bank` > 0: its right side dips) and pitching (`pitch` > 0: its nose rises).
 */
export function tiltPoint(x: number, y: number, z: number, bank: number, pitch: number) {
  const cb = Math.cos(bank);
  const sb = Math.sin(bank);
  // Bank: around its length (x).
  const y1 = y * cb + z * sb;
  const z1 = z * cb - y * sb;
  // Pitch: around its width (y).
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return { x: x * cp - z1 * sp, y: y1, z: z1 * cp + x * sp };
}

/** Which way the art is drawn: facing right (ships) or up (the Leviathan's pieces). */
export type Facing = 'right' | 'up';
/** Image offset (from the anchor) → the art's own frame (x forward, y to its right). */
const toOwn = (dx: number, dy: number, facing: Facing) => (facing === 'up' ? { x: -dy, y: dx } : { x: dx, y: dy });
/** The art's own frame → image offset. */
const toImage = (x: number, y: number, facing: Facing) => (facing === 'up' ? { x: y, y: -x } : { x, y });

/** Where a point on the ship (e.g. a mount, `x`/`y` from the image's anchor) goes when the ship tilts. */
export function tiltedSpot(sprite: Sprite, shape: VolumeShape, x: number, y: number, bank: number, pitch: number, facing: Facing = 'right') {
  const f = sprite.frames[0];
  const H = heightsOf(f, shape);
  const own = toOwn(x, y, facing);
  const p = tiltPoint(own.x, own.y, heightAt(H, x + sprite.anchorX, y + sprite.anchorY), bank, pitch);
  return toImage(p.x, p.y, facing);
}

// ---------- 3. Light, stepped to the palette ----------

interface Ramp {
  /** Colours of the same family (hue and colourfulness), darkest first, as packed RGBA. */
  colors: number[];
  light: number[];
}

const pack = (r: number, g: number, b: number, a: number) => ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;

function hsl(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (mx !== mn) {
    const R = r / 255;
    const G = g / 255;
    const B = b / 255;
    if (mx === R) hue = ((G - B) / (mx - mn) + 6) % 6;
    else if (mx === G) hue = (B - R) / (mx - mn) + 2;
    else hue = (R - G) / (mx - mn) + 4;
    hue *= 60;
  }
  return { h: hue, s, l };
}

const rampCache = new WeakMap<Uint8ClampedArray, Map<number, Ramp>>();

/** For each colour of the image: the other colours of its family (similar hue and colourfulness), by lightness. */
function rampsOf(rgba: Uint8ClampedArray) {
  const cached = rampCache.get(rgba);
  if (cached) return cached;
  const colors = new Map<number, { h: number; s: number; l: number }>();
  for (let i = 0; i < rgba.length; i += 4)
    if (rgba[i + 3] > 0) {
      const c = pack(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]);
      if (!colors.has(c)) colors.set(c, hsl(rgba[i], rgba[i + 1], rgba[i + 2]));
    }
  const ramps = new Map<number, Ramp>();
  for (const [c, a] of colors) {
    const family = [...colors].filter(([, b]) => {
      // Greys go with greys (only nearly colourless ones); colours with colours of about the same hue and colourfulness.
      const grey = (x: { s: number; l: number }) => x.s < 0.1 || x.l < 0.06 || x.l > 0.94;
      if (grey(a) || grey(b)) return grey(a) && grey(b);
      const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
      return dh < 18 && Math.abs(a.s - b.s) < 0.18;
    });
    family.sort((p, q) => p[1].l - q[1].l);
    ramps.set(c, { colors: family.map(([k]) => k), light: family.map(([, v]) => v.l) });
  }
  rampCache.set(rgba, ramps);
  return ramps;
}

/** The colour of `c`'s ramp closest to its own lightness + `shift`. */
function stepColor(ramps: Map<number, Ramp>, c: number, l: number, shift: number) {
  const ramp = ramps.get(c);
  if (!ramp || ramp.colors.length < 2) return c;
  const want = l + shift;
  let best = c;
  let bestD = Math.abs(shift);
  ramp.light.forEach((rl, i) => {
    const d = Math.abs(rl - want);
    if (d < bestD - 1e-6) {
      bestD = d;
      best = ramp.colors[i];
    }
  });
  return best;
}

// ---------- 4. The tilted copy ----------

const tiltCache = new WeakMap<Frame, Map<string, Frame & { ax: number; ay: number }>>();

/** New tilted pictures may only be made until this time (performance.now()); the game sets it each frame (tiltBudget). */
let deadline = Infinity;
/** Allow `ms` milliseconds of making new tilted pictures from now (call once per frame). */
export function tiltBudget(ms: number) {
  deadline = performance.now() + ms;
}

/** A frame tilted (angles snapped to TILT_STEP), with where its anchor now sits in the copy. */
function tiltedFrame(f: Frame, anchorX: number, anchorY: number, shape: VolumeShape, bank: number, pitch: number, light: boolean, step: number, facing: Facing) {
  const bs = Math.round(bank / step);
  const ps = Math.round(pitch / step);
  let byKey = tiltCache.get(f);
  if (!byKey) tiltCache.set(f, (byKey = new Map()));
  const key = `${step},${bs},${ps},${light ? 1 : 0},${facing}|${shape.height},${shape.round},${shape.spine}|${anchorX},${anchorY}`;
  const done = byKey.get(key);
  if (done) return done;
  // Out of time this frame: not made now (drawn flat; made on a later frame).
  if (performance.now() > deadline) return null;
  bank = bs * step;
  pitch = ps * step;
  const H = heightsOf(f, shape);
  const ramps = light ? rampsOf(H.rgba) : null;
  // Room around it: raised parts can slide past the image's edges.
  let zMax = 0;
  for (const v of H.z) zMax = Math.max(zMax, v);
  const m = Math.ceil(zMax * (Math.abs(Math.sin(bank)) + Math.abs(Math.sin(pitch)))) + 2;
  const W = H.w + 2 * m;
  const Ht = H.h + 2 * m;
  const zbuf = new Float32Array(W * Ht).fill(-Infinity);
  const src = new Int32Array(W * Ht).fill(-1);
  const shade = new Float32Array(W * Ht);
  for (let py = 0; py < H.h; py++)
    for (let px = 0; px < H.w; px++) {
      const i = py * H.w + px;
      if (H.rgba[i * 4 + 3] === 0) continue;
      // The surface's tilt here (for the light): from the height's slope.
      let delta = 0;
      if (light) {
        const gx = (heightAt(H, px + 1.5, py + 0.5) - heightAt(H, px - 0.5, py + 0.5)) / 2;
        const gy = (heightAt(H, px + 0.5, py + 1.5) - heightAt(H, px + 0.5, py - 0.5)) / 2;
        const n0 = [-gx, -gy, 1];
        const nl = Math.hypot(...n0);
        const n = n0.map((v) => v / nl);
        const own = toOwn(n[0], n[1], facing);
        const t = tiltPoint(own.x, own.y, n[2], bank, pitch);
        const back = toImage(t.x, t.y, facing);
        delta = back.x * LIGHT[0] + back.y * LIGHT[1] + t.z * LIGHT[2] - (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      }
      for (let sy = 0; sy < SUB; sy++)
        for (let sx = 0; sx < SUB; sx++) {
          const ux = px + (sx + 0.5) / SUB;
          const uy = py + (sy + 0.5) / SUB;
          const own = toOwn(ux - anchorX, uy - anchorY, facing);
          const t = tiltPoint(own.x, own.y, heightSmooth(H, ux, uy), bank, pitch);
          const p = { ...toImage(t.x, t.y, facing), z: t.z };
          const ox = Math.floor(p.x + anchorX) + m;
          const oy = Math.floor(p.y + anchorY) + m;
          if (ox < 0 || oy < 0 || ox >= W || oy >= Ht) continue;
          const o = oy * W + ox;
          if (p.z > zbuf[o]) {
            zbuf[o] = p.z;
            src[o] = i;
            shade[o] = delta;
          }
        }
    }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Ht;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, Ht);
  for (let o = 0; o < W * Ht; o++) {
    const i = src[o];
    if (i < 0) continue;
    let r = H.rgba[i * 4];
    let gg = H.rgba[i * 4 + 1];
    let b = H.rgba[i * 4 + 2];
    const a = H.rgba[i * 4 + 3];
    if (ramps && Math.abs(shade[o]) > 0.02) {
      const col = pack(r, gg, b, a);
      const stepped = stepColor(ramps, col, hsl(r, gg, b).l, shade[o] * LIGHT_STRENGTH);
      r = stepped >>> 24;
      gg = (stepped >>> 16) & 255;
      b = (stepped >>> 8) & 255;
    }
    img.data.set([r, gg, b, a], o * 4);
  }
  g.putImageData(img, 0, 0);
  const out = { image: c, sx: 0, sy: 0, w: W, h: Ht, ax: anchorX + m, ay: anchorY + m };
  byKey.set(key, out);
  return out;
}

/**
 * A sprite tilted by `bank` and `pitch` (radians, snapped to steps of `step` radians); the same
 * sprite when both are 0, or when its picture couldn't be made in this frame's time (tiltBudget).
 */
export function tiltedSprite(sprite: Sprite, shape: VolumeShape, bank: number, pitch: number, light: boolean, step = TILT_STEP, facing: Facing = 'right'): Sprite {
  if (Math.round(bank / step) === 0 && Math.round(pitch / step) === 0) return sprite;
  // The same tilted sprite object every time (other caches key on it, e.g. hit-flash silhouettes).
  let bySprite = spriteCache.get(sprite);
  if (!bySprite) spriteCache.set(sprite, (bySprite = new Map()));
  const key = `${step},${Math.round(bank / step)},${Math.round(pitch / step)},${light ? 1 : 0},${facing}|${shape.height},${shape.round},${shape.spine}`;
  const done = bySprite.get(key);
  if (done) return done;
  const frames = sprite.frames.map((f) => tiltedFrame(f, sprite.anchorX, sprite.anchorY, shape, bank, pitch, light, step, facing));
  if (frames.some((f) => !f)) return sprite;
  const ok = frames as (Frame & { ax: number; ay: number })[];
  const out = { ...sprite, frames: ok, anchorX: ok[0].ax, anchorY: ok[0].ay };
  bySprite.set(key, out);
  return out;
}
const spriteCache = new WeakMap<Sprite, Map<string, Sprite>>();

/** The tilt actually drawn (snapped to `step`), so parts placed with tiltedSpot match the picture. */
export const snapTilt = (a: number, step = TILT_STEP) => Math.round(a / step) * step;
