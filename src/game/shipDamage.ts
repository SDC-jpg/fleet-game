// Ship damage marks, the drawing side (docs/SHIP-DAMAGE.md). Hits remembered on a ship
// (damage.ts) become marks on its hull: a ragged blob at the spot it was hit, clipped to the
// hull's own pixels, its torn edge the hull's colour darkened and its inside the innards texture
// (vfx.damage-innards, tiled across the ship's image, so it can be repainted). Each mark is a
// tiny image of its own, drawn over the hull (following a banking hull like its parts do).
//
// Marks follow health too: a ship worn down without many hits gets extra marks, and repairs
// take marks away (CONFIG.damage.followHealth).

import type { Assets, Frame, Sprite } from '../engine/assets';
import type { PixelRenderer } from '../engine/renderer';
import { CONFIG } from './config';
import type { DamageHit, HitKind } from './damage';

/** What a ship needs to have marks (a real Ship, or ShipArt's pretend one). */
export interface Damageable {
  hp: number;
  stats: { maxHp: number };
  hits?: DamageHit[];
}

interface Mark {
  /** Its middle pixel in the ship's image (pixels from the image's top left). */
  px: number;
  py: number;
  kind: HitKind;
  strength: number;
  /** The image drawn, and its offset from the ship's anchor (art pixels). */
  sprite: Sprite;
  ox: number;
  oy: number;
}

interface Marks {
  marks: Mark[];
  /** The ship image they were made on (marks start again if it's a different one). */
  frame: Frame;
}

const shipMarks = new WeakMap<object, Marks>();
const pixelCache = new WeakMap<Frame, Uint8ClampedArray>();

/** A frame's pixels (RGBA), read once. */
function pixelsOf(f: Frame) {
  let d = pixelCache.get(f);
  if (!d) {
    const c = document.createElement('canvas');
    c.width = f.w;
    c.height = f.h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(f.image, f.sx, f.sy, f.w, f.h, 0, 0, f.w, f.h);
    d = g.getImageData(0, 0, f.w, f.h).data;
    pixelCache.set(f, d);
  }
  return d;
}

/** How many solid pixels an image has (its hull area), cached. */
const areaCache = new WeakMap<Frame, number>();
function hullArea(f: Frame) {
  let a = areaCache.get(f);
  if (a === undefined) {
    const d = pixelsOf(f);
    a = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) a++;
    areaCache.set(f, a);
  }
  return a;
}

/** Most marks on a ship of this tier. */
const maxMarks = (tier: number) => CONFIG.damage.maxMarks + CONFIG.damage.marksPerTier * (tier - 1);

/** A mark's radius in art pixels for a hit this hard on this image. */
function radiusFor(f: Frame, strength: number) {
  const D = CONFIG.damage;
  return Math.min(D.sizeMax, Math.sqrt(hullArea(f)) * (D.sizeMin + D.sizePerStrength * Math.sqrt(strength)));
}

/** A small repeatable random number for a pixel of a mark (so its edge is ragged but steady). */
function noise(seed: number, x: number, y: number) {
  let h = (seed * 374761393 + x * 668265263 + y * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The image of a mark of radius r at (px, py) on this frame, and where it sits. */
function makeMark(assets: Assets, f: Frame, anchorX: number, anchorY: number, px: number, py: number, kind: HitKind, strength: number): Mark {
  const D = CONFIG.damage;
  const src = pixelsOf(f);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < f.w && y < f.h && src[(y * f.w + x) * 4 + 3] > 0;
  const r = radiusFor(f, strength);
  const R = Math.ceil(r * (1 + D.ragged)) + 1;
  const seed = px * 31 + py * 17 + Math.floor(strength * 1000);
  const w = 2 * R + 1;
  const inBlob = new Uint8Array(w * w);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < w && inBlob[y * w + x] === 1;
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const ix = px - R + x;
      const iy = py - R + y;
      if (!solid(ix, iy)) continue;
      const d = Math.hypot(x - R, y - R);
      if (d <= 0.5 || d < r * (1 + D.ragged * (noise(seed, ix, iy) - 0.5) * 2)) inBlob[y * w + x] = 1;
    }
  // Its inside from the innards texture (tiled across the ship's image), its torn edge the hull's colour darkened.
  const tex = assets.has('vfx.damage-innards') ? assets.get('vfx.damage-innards').frames[0] : null;
  const texPx = tex ? pixelsOf(tex) : null;
  const c = document.createElement('canvas');
  c.width = c.height = w;
  const g = c.getContext('2d')!;
  const out = g.createImageData(w, w);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      const ix = px - R + x;
      const iy = py - R + y;
      const o = (y * w + x) * 4;
      // (Small marks are all hole: a torn edge needs room.)
      const edge = r >= D.edgeFrom && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1));
      if (edge || !tex || !texPx) {
        const s = (iy * f.w + ix) * 4;
        out.data[o] = src[s] * D.edgeShade;
        out.data[o + 1] = src[s + 1] * D.edgeShade;
        out.data[o + 2] = src[s + 2] * D.edgeShade;
        out.data[o + 3] = src[s + 3];
      } else {
        const t = ((iy % tex.h) * tex.w + (ix % tex.w)) * 4;
        out.data.set(texPx.subarray(t, t + 4), o);
        out.data[o + 3] = Math.min(out.data[o + 3], src[(iy * f.w + ix) * 4 + 3]);
      }
    }
  g.putImageData(out, 0, 0);
  const sprite: Sprite = { frames: [{ image: c, sx: 0, sy: 0, w, h: w }], fps: 0, loop: false, anchorX: R + 0.5, anchorY: R + 0.5 };
  return { px, py, kind, strength, sprite, ox: px + 0.5 - anchorX, oy: py + 0.5 - anchorY };
}

/** The solid pixel nearest a hit: straight in toward the middle until it meets the hull. */
function snapToHull(f: Frame, anchorX: number, anchorY: number, x: number, y: number) {
  const src = pixelsOf(f);
  const solid = (px: number, py: number) => px >= 0 && py >= 0 && px < f.w && py < f.h && src[(py * f.w + px) * 4 + 3] > 0;
  const dx = anchorX - x;
  const dy = anchorY - y;
  const steps = Math.ceil(Math.hypot(dx, dy)) + 1;
  for (let i = 0; i <= steps; i++) {
    const px = Math.floor(x + (dx * i) / steps);
    const py = Math.floor(y + (dy * i) / steps);
    if (solid(px, py)) return { px, py };
  }
  return null;
}

/** A random solid pixel a little inside the hull (for marks that follow health). */
function randomHullPixel(f: Frame) {
  const src = pixelsOf(f);
  const solid = (px: number, py: number) => px >= 0 && py >= 0 && px < f.w && py < f.h && src[(py * f.w + px) * 4 + 3] > 0;
  for (let k = 0; k < 40; k++) {
    const px = Math.floor(Math.random() * f.w);
    const py = Math.floor(Math.random() * f.h);
    if (solid(px, py) && solid(px - 1, py) && solid(px + 1, py) && solid(px, py - 1) && solid(px, py + 1)) return { px, py };
  }
  return null;
}

/** Add a hit to the marks: it grows a mark it lands on, else makes a new one (the weakest goes when there are too many). */
function addMark(assets: Assets, m: Marks, sprite: Sprite, tier: number, px: number, py: number, kind: HitKind, strength: number) {
  const f = m.frame;
  const near = m.marks.find((k) => k.kind === kind && Math.hypot(k.px - px, k.py - py) <= radiusFor(f, k.strength) * CONFIG.damage.mergeReach);
  if (near) {
    const grown = makeMark(assets, f, sprite.anchorX, sprite.anchorY, near.px, near.py, kind, Math.min(1, near.strength + strength));
    m.marks[m.marks.indexOf(near)] = grown;
    return;
  }
  if (m.marks.length >= maxMarks(tier)) {
    const weakest = m.marks.reduce((a, b) => (b.strength < a.strength ? b : a));
    m.marks.splice(m.marks.indexOf(weakest), 1);
  }
  m.marks.push(makeMark(assets, f, sprite.anchorX, sprite.anchorY, px, py, kind, strength));
}

/**
 * Update a ship's marks (new hits, following its health) and draw them over its hull. `sprite` is
 * its hull image as drawn (flat), `spot` moves a point of it with a banking hull, `scale` its size.
 */
export function drawDamage(r: PixelRenderer, assets: Assets, s: Damageable, tier: number, sprite: Sprite, spot: (x: number, y: number) => { x: number; y: number }, x: number, y: number, angle: number, scale: number, alpha: number) {
  const D = CONFIG.damage;
  const f = sprite.frames[0];
  let m = shipMarks.get(s);
  if (!m || m.frame !== f) shipMarks.set(s, (m = { marks: [], frame: f }));
  // New hits (in game pixels from the ship's middle → its image's pixels).
  for (const h of s.hits ?? []) {
    const p = snapToHull(f, sprite.anchorX, sprite.anchorY, sprite.anchorX + h.x / scale, sprite.anchorY + h.y / scale);
    if (p) addMark(assets, m, sprite, tier, p.px, p.py, h.kind, h.strength);
  }
  if (s.hits) s.hits.length = 0;
  // Follow health: repaired, marks go (the oldest first); worn down with few marks, an extra one.
  const lost = Math.max(0, 1 - s.hp / s.stats.maxHp);
  const total = () => m.marks.reduce((n, k) => n + k.strength, 0);
  while (m.marks.length && total() > lost * 1.2 + 0.01) m.marks.shift();
  if (total() < lost * D.followHealth && m.marks.length < maxMarks(tier)) {
    const p = randomHullPixel(f);
    if (p) addMark(assets, m, sprite, tier, p.px, p.py, 'gun', D.extraStrength);
  }
  // Drawn as on a grid (each mark is its own little image: RotSprite would keep a turned copy of each).
  const mode = r.rotation;
  if (mode === 'rotsprite') r.rotation = 'grid';
  for (const k of m.marks) {
    const p = spot(k.ox, k.oy);
    r.drawAttached(k.sprite, x, y, angle, p.x * scale, p.y * scale, 0, 0, alpha, scale);
  }
  r.rotation = mode;
}

/** Forget a ship's marks (ShipArt's Repair button). */
export function clearDamage(s: Damageable) {
  shipMarks.delete(s);
  if (s.hits) s.hits.length = 0;
}
