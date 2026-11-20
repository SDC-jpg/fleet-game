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
import { tiltedSprite, type VolumeShape } from '../engine/tilt';
import type { Particles } from './particles';

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
  /** The ship image they were made on (marks start again if it's a different one), as last drawn, and its size. */
  frame: Frame;
  sprite: Sprite;
  scale: number;
  /** Energy burns: heat and scorch per hull pixel (made at the first burn). */
  heat: Heat | null;
  /** Smoke from strong burns: where (offset from the anchor, art pixels) and until when; and burn adding up toward the next puff. */
  smoke: { ox: number; oy: number; until: number }[];
  burn: number;
  /** The time it was last drawn (for cooling). */
  time: number;
}

/** A ship's burns (energy hits): each hull pixel's heat (1 = white hot, cooling to 0) and scorch (0–1). */
interface Heat {
  heat: Float32Array;
  scorch: Float32Array;
  /** How much damage its scorch stands for (strengths added up, for following health). */
  strength: number;
  /** The part that changed since the image was last made (pixels), or null. */
  dirty: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Pixels still hot (they cool each frame). */
  hot: { x0: number; y0: number; x1: number; y1: number } | null;
  /** The image being drawn into while it's hot, and the finished image once it has cooled (a new one each time, so the 3D tilt's copies stay right). */
  work: HTMLCanvasElement;
  image: ImageData;
  sprite: Sprite;
  cooled: Sprite | null;
}

const shipMarks = new WeakMap<object, Marks>();

/** Grow a box to take in a pixel (or start one). */
const grow = (b: Heat['dirty'], x: number, y: number) =>
  b ? { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) } : { x0: x, y0: y, x1: x, y1: y };

function makeHeat(f: Frame, anchorX: number, anchorY: number): Heat {
  const work = document.createElement('canvas');
  work.width = f.w;
  work.height = f.h;
  const image = work.getContext('2d')!.createImageData(f.w, f.h);
  return {
    heat: new Float32Array(f.w * f.h),
    scorch: new Float32Array(f.w * f.h),
    strength: 0,
    dirty: null,
    hot: null,
    work,
    image,
    sprite: { frames: [{ image: work, sx: 0, sy: 0, w: f.w, h: f.h }], fps: 0, loop: false, anchorX, anchorY },
    cooled: null,
  };
}

/** Heat the hull around (px, py): `amount` in the middle, less toward the edge of radius r; heat leaves scorch. */
function addHeat(f: Frame, h: Heat, px: number, py: number, r: number, amount: number) {
  const src = pixelsOf(f);
  const R = Math.ceil(r);
  for (let y = py - R; y <= py + R; y++)
    for (let x = px - R; x <= px + R; x++) {
      if (x < 0 || y < 0 || x >= f.w || y >= f.h || src[(y * f.w + x) * 4 + 3] === 0) continue;
      const d = Math.hypot(x - px, y - py);
      if (d > r + 0.5) continue;
      const k = amount * Math.min(1, 1 - (d - 0.5) / (r + 1));
      const i = y * f.w + x;
      h.heat[i] = Math.min(1, h.heat[i] + k);
      h.scorch[i] = Math.max(h.scorch[i], Math.min(1, k * 1.4));
      h.dirty = grow(h.dirty, x, y);
      h.hot = grow(h.hot, x, y);
    }
}

/** Cool the hot pixels by `by`; returns whether any are still hot. */
function cool(f: Frame, h: Heat, by: number) {
  if (!h.hot) return false;
  const b = h.hot;
  let still = false;
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * f.w + x;
      if (h.heat[i] <= 0) continue;
      h.heat[i] = Math.max(0, h.heat[i] - by);
      if (h.heat[i] > 0) still = true;
    }
  h.dirty = h.dirty ? { x0: Math.min(h.dirty.x0, b.x0), y0: Math.min(h.dirty.y0, b.y0), x1: Math.max(h.dirty.x1, b.x1), y1: Math.max(h.dirty.y1, b.y1) } : { ...b };
  if (!still) h.hot = null;
  return still;
}

/**
 * Remake the changed part of the burns image: hot pixels in the colour of the heat ramp
 * (vfx.damage-heat: its first pixel is white hot, its last cold), scorched ones the hull's colour
 * turned toward the scorch texture (vfx.damage-scorch, tiled across the image).
 */
function paintHeat(assets: Assets, f: Frame, h: Heat) {
  const b = h.dirty;
  if (!b) return;
  h.dirty = null;
  const D = CONFIG.damage;
  const src = pixelsOf(f);
  const ramp = assets.has('vfx.damage-heat') ? assets.get('vfx.damage-heat').frames[0] : null;
  const rampPx = ramp ? pixelsOf(ramp) : null;
  const tex = assets.has('vfx.damage-scorch') ? assets.get('vfx.damage-scorch').frames[0] : null;
  const texPx = tex ? pixelsOf(tex) : null;
  const out = h.image.data;
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      const i = y * f.w + x;
      const o = i * 4;
      const heat = h.heat[i];
      const sc = h.scorch[i];
      if (heat <= 0 && sc <= 0) {
        out[o + 3] = 0;
        continue;
      }
      // Scorched: the hull's colour turned toward the scorch texture.
      const t = tex && texPx ? ((y % tex.h) * tex.w + (x % tex.w)) * 4 : -1;
      const k = sc * D.scorchMix;
      for (let c = 0; c < 3; c++) out[o + c] = src[o + c] * (1 - k) + (t >= 0 ? texPx![t + c] : 0) * k;
      out[o + 3] = src[o + 3];
      // Hot: the heat ramp's colour over it (heat 1 = the ramp's first pixel, nearly cold = its last), fading as it cools.
      if (heat > 0 && ramp && rampPx) {
        const j = Math.min(ramp.w - 1, Math.floor((1 - heat) * ramp.w)) * 4;
        const w = (Math.min(1, heat * 3) * rampPx[j + 3]) / 255;
        for (let c = 0; c < 3; c++) out[o + c] = out[o + c] * (1 - w) + rampPx[j + c] * w;
      }
    }
  h.work.getContext('2d')!.putImageData(h.image, 0, 0, b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  h.cooled = null;
}

/** The burns image to draw: the working one while hot, else a finished copy (made once). */
function heatSprite(h: Heat) {
  if (h.hot) return h.sprite;
  if (!h.cooled) {
    const c = document.createElement('canvas');
    c.width = h.work.width;
    c.height = h.work.height;
    c.getContext('2d')!.drawImage(h.work, 0, 0);
    h.cooled = { ...h.sprite, frames: [{ ...h.sprite.frames[0], image: c }] };
  }
  return h.cooled;
}
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

/**
 * The hull pixel a hit lands on: on along the way it was going (dx, dy) until it meets the hull,
 * else straight in toward the middle. Also how far it went (art pixels).
 */
function snapToHull(f: Frame, anchorX: number, anchorY: number, x: number, y: number, dx?: number, dy?: number) {
  const src = pixelsOf(f);
  const solid = (px: number, py: number) => px >= 0 && py >= 0 && px < f.w && py < f.h && src[(py * f.w + px) * 4 + 3] > 0;
  if (dx !== undefined && dy !== undefined) {
    const reach = f.w + f.h;
    for (let i = 0; i <= reach; i++) {
      const px = Math.floor(x + dx * i);
      const py = Math.floor(y + dy * i);
      if (solid(px, py)) return { px, py, depth: i };
    }
  }
  const tx = anchorX - x;
  const ty = anchorY - y;
  const steps = Math.ceil(Math.hypot(tx, ty)) + 1;
  for (let i = 0; i <= steps; i++) {
    const px = Math.floor(x + (tx * i) / steps);
    const py = Math.floor(y + (ty * i) / steps);
    if (solid(px, py)) return { px, py, depth: 0 };
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

/** A hull's banking for drawing its burns as a 3D hull (drawLayoutArt), or none. */
export interface DecorTilt {
  bank: number;
  pitch: number;
  step?: number;
  shape: VolumeShape;
}

/**
 * Update a ship's marks (new hits, burns cooling, following its health) and draw them over its
 * hull. `sprite` is its hull image as drawn (flat), `spot` moves a point of it with a banking
 * hull (`tilt`), `scale` its size, `time` the game's clock (burns cool with it).
 */
export function drawDamage(
  r: PixelRenderer,
  assets: Assets,
  s: Damageable,
  tier: number,
  sprite: Sprite,
  spot: (x: number, y: number) => { x: number; y: number },
  x: number,
  y: number,
  angle: number,
  scale: number,
  alpha: number,
  time: number,
  tilt?: DecorTilt,
) {
  const D = CONFIG.damage;
  const f = sprite.frames[0];
  let m = shipMarks.get(s);
  if (!m || m.frame !== f) shipMarks.set(s, (m = { marks: [], frame: f, sprite, scale, heat: null, smoke: [], burn: 0, time }));
  m.sprite = sprite;
  m.scale = scale;
  const dt = Math.min(0.1, Math.max(0, time - m.time));
  m.time = time;
  // New hits (in game pixels from the ship's middle → its image's pixels).
  for (const h of s.hits ?? []) {
    const p = h.random ? randomHullPixel(f) : snapToHull(f, sprite.anchorX, sprite.anchorY, sprite.anchorX + h.x / scale, sprite.anchorY + h.y / scale, h.dx, h.dy);
    if (!p) continue;
    if (h.kind !== 'energy') {
      addMark(assets, m, sprite, tier, p.px, p.py, h.kind, h.strength);
      continue;
    }
    // Energy burns: a white-hot spot cooling to scorch; the Laser burns a line right across.
    const heat = (m.heat ??= makeHeat(f, sprite.anchorX, sprite.anchorY));
    const r0 = Math.max(D.burnMin, radiusFor(f, h.strength) * D.burnSize);
    if (h.through && h.dx !== undefined && h.dy !== undefined) {
      for (let i = 0; i <= f.w + f.h; i++) {
        const lx = Math.floor(p.px + h.dx * i);
        const ly = Math.floor(p.py + h.dy * i);
        if (lx < 0 || ly < 0 || lx >= f.w || ly >= f.h) break;
        addHeat(f, heat, lx, ly, Math.max(D.burnMin, r0 * D.lineWidth), 1);
      }
    } else addHeat(f, heat, p.px, p.py, r0, 1);
    heat.strength += h.strength;
    // Strong burns (or a beam burning on) smoke for a while.
    m.burn += h.strength;
    if (m.burn >= D.smokeFrom) {
      m.burn = 0;
      m.smoke.push({ ox: p.px + 0.5 - sprite.anchorX, oy: p.py + 0.5 - sprite.anchorY, until: time + D.smokeTime });
      if (m.smoke.length > D.smokeSpots) m.smoke.shift();
    }
  }
  if (s.hits) s.hits.length = 0;
  m.burn = Math.max(0, m.burn - dt * D.burnFade);
  m.smoke = m.smoke.filter((k) => k.until > time);
  // Follow health: repaired, marks go (the oldest first, then the burns); worn down with few marks, an extra one.
  const lost = Math.max(0, 1 - s.hp / s.stats.maxHp);
  const total = () => m.marks.reduce((n, k) => n + k.strength, 0) + (m.heat?.strength ?? 0);
  while (m.marks.length && total() > lost * 1.2 + 0.01) m.marks.shift();
  if (m.heat && total() > lost * 1.2 + 0.01) m.heat = null;
  if (total() < lost * D.followHealth && m.marks.length < maxMarks(tier)) {
    const p = randomHullPixel(f);
    if (p) addMark(assets, m, sprite, tier, p.px, p.py, 'gun', D.extraStrength);
  }
  // Burns cool, and their image is remade where it changed.
  if (m.heat) {
    cool(f, m.heat, dt / D.coolTime);
    paintHeat(assets, f, m.heat);
  }
  // Drawn as on a grid (each mark is its own little image: RotSprite would keep a turned copy of each).
  const mode = r.rotation;
  if (mode === 'rotsprite') r.rotation = 'grid';
  if (m.heat) {
    // Cooled burns bank with the hull as a 3D copy; hot ones change every frame, so they're drawn flat.
    let img = heatSprite(m.heat);
    if (tilt && !m.heat.hot) img = tiltedSprite(img, tilt.shape, tilt.bank, tilt.pitch, false, tilt.step);
    r.drawRotated(img, x, y, angle, 0, alpha, scale);
  }
  for (const k of m.marks) {
    const p = spot(k.ox, k.oy);
    r.drawAttached(k.sprite, x, y, angle, p.x * scale, p.y * scale, 0, 0, alpha, scale);
  }
  r.rotation = mode;
}

/**
 * How much further into a ship a beam goes past the edge of its hit circle before it meets the
 * hull (game pixels; 0 if it hasn't been drawn yet), so a beam is drawn burning the hull, not the
 * empty space around it. (wx, wy) = where it reaches the hit circle, (dx, dy) its direction.
 */
export function hullDepth(s: Damageable & { x: number; y: number; angle: number }, wx: number, wy: number, dx: number, dy: number) {
  const m = shipMarks.get(s);
  if (!m) return 0;
  const { sprite, scale, frame: f } = m;
  const lx = wx - s.x;
  const ly = wy - s.y;
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  const px = sprite.anchorX + (lx * c + ly * n) / scale;
  const py = sprite.anchorY + (-lx * n + ly * c) / scale;
  const p = snapToHull(f, sprite.anchorX, sprite.anchorY, px, py, dx * c + dy * n, -dx * n + dy * c);
  return p && p.depth < f.w + f.h ? p.depth * scale : 0;
}

/** Smoke from a ship's strong burns (Game.ts, with the thrusters' particles). */
export function emitDamageSmoke(particles: Particles, s: Damageable & { x: number; y: number; angle: number; vx: number; vy: number }, dt: number) {
  const m = shipMarks.get(s);
  if (!m?.smoke.length) return;
  const D = CONFIG.damage;
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  for (const k of m.smoke) {
    const ox = k.ox * m.scale;
    const oy = k.oy * m.scale;
    particles.emit({ ...D.smoke, perSecond: D.smoke.perSecond * Math.sqrt(m.scale) }, s.x + ox * c - oy * n, s.y + ox * n + oy * c, Math.random() * Math.PI * 2, dt, s.vx, s.vy);
  }
}

/** Forget a ship's marks (ShipArt's Repair button). */
export function clearDamage(s: Damageable) {
  shipMarks.delete(s);
  if (s.hits) s.hits.length = 0;
}
