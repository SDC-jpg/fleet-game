// RotSprite-style rotation for pixel art (used when the renderer's rotation
// mode is 'rotsprite').
//
// Rotating pixel art directly makes "laddering": some rows and columns get
// doubled, others dropped. RotSprite avoids most of it by enlarging the art 8×
// with an edge-smoothing rule (Scale2x, three times), rotating that, and
// shrinking it back. Edges stay clean, and only the art's own colours are used.
//
// Here the 8× copy is made once per image, and each rotated version is made
// the first time it's needed and then kept (rotation snaps to ROT_STEPS steps).

import type { Frame } from './assets';

/** Angle steps in a full turn (128 = about 2.8° each). */
export const ROT_STEPS = 128;

/** A rotated copy, and where its top-left corner sits relative to the sprite's anchor (in art pixels). */
export interface Rotated {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

/** The art, trimmed to its visible pixels and enlarged 8×. */
interface Source {
  /** 8× pixels, one 32-bit RGBA value each. */
  big: Uint32Array;
  bw: number;
  bh: number;
  /** Size at 1× after trimming. */
  w: number;
  h: number;
  /** The anchor in trimmed 1× coordinates. */
  ax: number;
  ay: number;
  /** Rotated copies made so far, by angle step. */
  rotated: Map<number, Rotated>;
}

const sources = new WeakMap<Frame, Map<string, Source>>();

/** Scale2x: doubles the image, rounding off staircase corners without adding colours. */
function scale2x(src: Uint32Array, w: number, h: number): Uint32Array {
  const out = new Uint32Array(w * 2 * h * 2);
  const at = (x: number, y: number) => src[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const ow = w * 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = src[y * w + x];
      const a = at(x, y - 1); // above
      const b = at(x + 1, y); // right
      const c = at(x - 1, y); // left
      const d = at(x, y + 1); // below
      let e0 = p, e1 = p, e2 = p, e3 = p;
      if (a !== d && c !== b) {
        if (c === a) e0 = a;
        if (a === b) e1 = b;
        if (c === d) e2 = c;
        if (d === b) e3 = d;
      }
      const o = y * 2 * ow + x * 2;
      out[o] = e0;
      out[o + 1] = e1;
      out[o + ow] = e2;
      out[o + ow + 1] = e3;
    }
  return out;
}

/** Read a frame's pixels (mirrored if asked), trim the empty border, and enlarge it 8×. */
function makeSource(f: Frame, anchorX: number, anchorY: number, flipX: boolean, flipY: boolean): Source {
  const c = document.createElement('canvas');
  c.width = f.w;
  c.height = f.h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(flipX ? -1 : 1, 0, 0, flipY ? -1 : 1, flipX ? f.w : 0, flipY ? f.h : 0);
  ctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, 0, 0, f.w, f.h);
  const all = new Uint32Array(ctx.getImageData(0, 0, f.w, f.h).data.buffer);
  // A mirrored image's anchor is mirrored too.
  const ax0 = flipX ? f.w - anchorX : anchorX;
  const ay0 = flipY ? f.h - anchorY : anchorY;
  // Trim to the visible pixels (less to enlarge and rotate).
  let x0 = f.w, y0 = f.h, x1 = -1, y1 = -1;
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++)
      if (all[y * f.w + x] >>> 24) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return { big: new Uint32Array(0), bw: 0, bh: 0, w: 0, h: 0, ax: 0, ay: 0, rotated: new Map() };
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  let px = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) px.set(all.subarray((y0 + y) * f.w + x0, (y0 + y) * f.w + x0 + w), y * w);
  // Fully transparent pixels all count as the same "colour", whatever their RGB.
  for (let i = 0; i < px.length; i++) if (!(px[i] >>> 24)) px[i] = 0;
  let bw = w, bh = h;
  for (let k = 0; k < 3; k++) {
    px = scale2x(px, bw, bh);
    bw *= 2;
    bh *= 2;
  }
  return { big: px, bw, bh, w, h, ax: ax0 - x0, ay: ay0 - y0, rotated: new Map() };
}

/** Build the rotated copy for one angle step: each pixel takes the colour at its centre in the 8× art. */
function rotate(s: Source, step: number): Rotated {
  const a = (step / ROT_STEPS) * Math.PI * 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Where the trimmed image's corners land, relative to the anchor, to size the result.
  const corners = [
    [-s.ax, -s.ay],
    [s.w - s.ax, -s.ay],
    [-s.ax, s.h - s.ay],
    [s.w - s.ax, s.h - s.ay],
  ].map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
  const left = Math.floor(Math.min(...corners.map((p) => p[0])));
  const top = Math.floor(Math.min(...corners.map((p) => p[1])));
  const ow = Math.max(1, Math.ceil(Math.max(...corners.map((p) => p[0]))) - left);
  const oh = Math.max(1, Math.ceil(Math.max(...corners.map((p) => p[1]))) - top);
  const canvas = document.createElement('canvas');
  canvas.width = ow;
  canvas.height = oh;
  if (s.bw > 0) {
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(ow, oh);
    const out = new Uint32Array(img.data.buffer);
    for (let y = 0; y < oh; y++)
      for (let x = 0; x < ow; x++) {
        // This pixel's centre, relative to the anchor, turned back to the unrotated art.
        const cx = left + x + 0.5;
        const cy = top + y + 0.5;
        const sx = s.ax + cx * cos + cy * sin;
        const sy = s.ay - cx * sin + cy * cos;
        const bx = Math.floor(sx * 8);
        const by = Math.floor(sy * 8);
        if (bx < 0 || by < 0 || bx >= s.bw || by >= s.bh) continue;
        out[y * ow + x] = s.big[by * s.bw + bx];
      }
    ctx.putImageData(img, 0, 0);
  }
  return { canvas, x: left, y: top };
}

/** Turn an angle (radians) into the nearest of the ROT_STEPS steps (0 … ROT_STEPS − 1). */
export const angleStep = (angle: number) => (((Math.round((angle / (Math.PI * 2)) * ROT_STEPS) % ROT_STEPS) + ROT_STEPS) % ROT_STEPS);

/** The angle (radians) of a step. */
export const stepAngle = (step: number) => (step / ROT_STEPS) * Math.PI * 2;

/** A frame rotated to `step` around its anchor (mirrored first if asked). Made on first use, then kept. */
export function rotatedFrame(f: Frame, anchorX: number, anchorY: number, step: number, flipX = false, flipY = false): Rotated {
  let byKey = sources.get(f);
  if (!byKey) sources.set(f, (byKey = new Map()));
  const key = `${anchorX},${anchorY},${flipX ? 1 : 0}${flipY ? 1 : 0}`;
  let s = byKey.get(key);
  if (!s) byKey.set(key, (s = makeSource(f, anchorX, anchorY, flipX, flipY)));
  let r = s.rotated.get(step);
  if (!r) s.rotated.set(step, (r = rotate(s, step)));
  return r;
}
