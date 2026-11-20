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
import { tiltedSprite, type Facing, type VolumeShape } from '../engine/tilt';
import type { Particles } from './particles';
import type { ParticleSettings } from './artLayout';

/** What a ship needs to have marks (a real Ship, or ShipArt's pretend one). */
export interface Damageable {
  hp: number;
  stats: { maxHp: number };
  hits?: DamageHit[];
  /** How fast it's moving (its debris keeps some of it). */
  vx?: number;
  vy?: number;
}

/**
 * What damage looks like on something: ships (plating torn open on innards, soot, smoke and sparks)
 * or the Leviathan's flesh (glowing flesh inside charred edges, purple burns, blood drops).
 */
export interface DamageLook {
  /** Textures (sprite names, repeated across the image): inside torn marks, their edges (null = the hull's own colour darkened), and burns' scorch. */
  inside: string;
  /** Inside a wound (the Leviathan's blood bursting out): glowing. */
  woundInside: string;
  edge: string | null;
  scorch: string;
  /** Burns' colours from hottest (left) to cold (right). */
  heat: string;
  /** From burns and badly hurt spots (smoke or blood drops), and in bursts below half health (sparks or blood spurts). */
  smoke: ParticleSettings;
  spark: ParticleSettings;
  /** Share of those particles given off (the Leviathan has many pieces). */
  particles: number;
  /** Most marks (else by tier). */
  maxMarks?: number;
  /** Marks go when it's repaired (ships); the Leviathan never heals, so its stay. */
  repairs: boolean;
  /** A wound's rim (pixels wide). */
  woundRim: number;
}

/** Ships' damage look (CONFIG.damage). */
const shipLook = (): DamageLook => ({
  inside: 'vfx.damage-innards',
  woundInside: 'vfx.damage-innards',
  edge: null,
  scorch: 'vfx.damage-scorch',
  heat: 'vfx.damage-heat',
  smoke: CONFIG.damage.smoke,
  spark: CONFIG.damage.spark,
  particles: 1,
  repairs: true,
  woundRim: 1,
});

/** The Leviathan's flesh (CONFIG.leviathan.damage). */
export const fleshLook = (): DamageLook => {
  const L = CONFIG.leviathan.damage;
  return { inside: L.torn, woundInside: L.inside, edge: L.char, scorch: L.char, heat: L.heat, smoke: L.drops, spark: L.spurt, particles: L.perPiece, maxMarks: L.maxMarks, repairs: false, woundRim: L.woundRim };
};

/** A piece of a ship knocked off by a hit: a few pixels cut from its own image, tumbling away. */
interface Chip {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  scale: number;
  age: number;
  life: number;
}
let chips: Chip[] = [];
let chipsTime = 0;

/** Cut a piece about `size` pixels across out of the image around (px, py) (only its solid pixels). */
function cutChip(f: Frame, px: number, py: number, size: number): Sprite | null {
  const src = pixelsOf(f);
  const n = Math.max(1, Math.round(size));
  const x0 = px - Math.floor(n / 2);
  const y0 = py - Math.floor(n / 2);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const out = g.createImageData(n, n);
  let any = false;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const ix = x0 + x;
      const iy = y0 + y;
      if (ix < 0 || iy < 0 || ix >= f.w || iy >= f.h) continue;
      const i = (iy * f.w + ix) * 4;
      // Ragged: a corner pixel now and then is missing.
      if (src[i + 3] === 0 || (n > 2 && (x === 0 || x === n - 1) && (y === 0 || y === n - 1) && Math.random() < 0.5)) continue;
      out.data.set(src.subarray(i, i + 4), (y * n + x) * 4);
      any = true;
    }
  if (!any) return null;
  g.putImageData(out, 0, 0);
  return { frames: [{ image: c, sx: 0, sy: 0, w: n, h: n }], fps: 0, loop: false, anchorX: n / 2, anchorY: n / 2 };
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
  look: DamageLook;
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
  /** Spots picked on its hull for sparks and smoke while it has no marks (damagedSpots). */
  spots?: { ox: number; oy: number }[];
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
function paintHeat(assets: Assets, look: DamageLook, f: Frame, h: Heat) {
  const b = h.dirty;
  if (!b) return;
  h.dirty = null;
  const D = CONFIG.damage;
  const src = pixelsOf(f);
  const ramp = assets.has(look.heat) ? assets.get(look.heat).frames[0] : null;
  const rampPx = ramp ? pixelsOf(ramp) : null;
  const tex = assets.has(look.scorch) ? assets.get(look.scorch).frames[0] : null;
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
function makeMark(assets: Assets, look: DamageLook, f: Frame, anchorX: number, anchorY: number, px: number, py: number, kind: HitKind, strength: number): Mark {
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
  // Its inside from the inside texture (tiled across the image), its torn edge the edge texture or the hull's colour darkened.
  const insideName = kind === 'wound' ? look.woundInside : look.inside;
  const tex = assets.has(insideName) ? assets.get(insideName).frames[0] : null;
  const texPx = tex ? pixelsOf(tex) : null;
  const edgeTex = look.edge && assets.has(look.edge) ? assets.get(look.edge).frames[0] : null;
  const edgePx = edgeTex ? pixelsOf(edgeTex) : null;
  // A wound's rim is wider; it's an edge pixel if any pixel within the rim is outside the mark.
  const rim = kind === 'wound' ? look.woundRim : 1;
  const nearOutside = (x: number, y: number) => {
    for (let j = -rim; j <= rim; j++) for (let i = -rim; i <= rim; i++) if (Math.abs(i) + Math.abs(j) <= rim && !inside(x + i, y + j)) return true;
    return false;
  };
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
      const edge = r >= D.edgeFrom && nearOutside(x, y);
      if (edge && edgeTex && edgePx) {
        const t = ((iy % edgeTex.h) * edgeTex.w + (ix % edgeTex.w)) * 4;
        out.data.set(edgePx.subarray(t, t + 4), o);
        out.data[o + 3] = Math.min(out.data[o + 3], src[(iy * f.w + ix) * 4 + 3]);
      } else if (edge || !tex || !texPx) {
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
  // (No glow on marks: glow is drawn over everything, so a piece sliding over another couldn't hide it.)
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
    const grown = makeMark(assets, m.look, f, sprite.anchorX, sprite.anchorY, near.px, near.py, kind, Math.min(1, near.strength + strength));
    m.marks[m.marks.indexOf(near)] = grown;
    return;
  }
  if (m.marks.length >= (m.look.maxMarks ?? maxMarks(tier))) {
    const weakest = m.marks.reduce((a, b) => (b.strength < a.strength ? b : a));
    m.marks.splice(m.marks.indexOf(weakest), 1);
  }
  m.marks.push(makeMark(assets, m.look, f, sprite.anchorX, sprite.anchorY, px, py, kind, strength));
}

/** A hull's banking for drawing its burns as a 3D hull (drawLayoutArt), or none. */
export interface DecorTilt {
  bank: number;
  pitch: number;
  step?: number;
  shape: VolumeShape;
  /** Which way its art faces (ships right, the Leviathan's pieces up). */
  facing?: Facing;
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
  look: DamageLook = shipLook(),
) {
  const D = CONFIG.damage;
  const f = sprite.frames[0];
  let m = shipMarks.get(s);
  if (!m || m.frame !== f) shipMarks.set(s, (m = { marks: [], look, frame: f, sprite, scale, heat: null, smoke: [], burn: 0, time }));
  m.look = look;
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
      // Missiles also burn a ring around their hole.
      if (h.kind === 'missile') addHeat(f, (m.heat ??= makeHeat(f, sprite.anchorX, sprite.anchorY)), p.px, p.py, Math.max(D.burnMin, radiusFor(f, h.strength) * D.missileBurnSize), D.missileHeat);
      // Pieces knocked off, flying back the way the shot came from.
      knockDebris(f, sprite, p.px, p.py, h, s, x, y, angle, scale);
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
  if (look.repairs) {
    while (m.marks.length && total() > lost * 1.2 + 0.01) m.marks.shift();
    if (m.heat && (total() > lost * 1.2 + 0.01 || lost < 0.02)) m.heat = null;
  }
  // (Only if the extra mark wouldn't be too much for its health at once: else it would come and go every frame.)
  if (total() < lost * D.followHealth && total() + D.extraStrength <= lost * 1.2 && m.marks.length < (look.maxMarks ?? maxMarks(tier))) {
    const p = randomHullPixel(f);
    if (p) addMark(assets, m, sprite, tier, p.px, p.py, 'gun', D.extraStrength);
  }
  // Burns cool, and their image is remade where it changed.
  if (m.heat) {
    cool(f, m.heat, dt / D.coolTime);
    paintHeat(assets, look, f, m.heat);
  }
  // Drawn as on a grid (each mark is its own little image: RotSprite would keep a turned copy of each).
  const mode = r.rotation;
  if (mode === 'rotsprite') r.rotation = 'grid';
  if (m.heat) {
    // Cooled burns bank with the hull as a 3D copy; hot ones change every frame, so they're drawn flat.
    let img = heatSprite(m.heat);
    if (tilt && !m.heat.hot) img = tiltedSprite(img, tilt.shape, tilt.bank, tilt.pitch, false, tilt.step, tilt.facing);
    r.drawRotated(img, x, y, angle, 0, alpha, scale);
  }
  for (const k of m.marks) {
    const p = spot(k.ox, k.oy);
    r.drawAttached(k.sprite, x, y, angle, p.x * scale, p.y * scale, 0, 0, alpha, scale);
  }
  r.rotation = mode;
}

/** Debris from a gun or missile hit at (px, py) on the image (chance and amount by its strength). */
function knockDebris(f: Frame, sprite: Sprite, px: number, py: number, h: DamageHit, s: Damageable, x: number, y: number, angle: number, scale: number) {
  const D = CONFIG.damage;
  const chance = h.strength * D.debrisChance * (h.kind === 'missile' ? D.missileDebris : 1);
  if (Math.random() >= chance) return;
  const count = Math.min(D.debrisMax, 1 + Math.floor(h.strength * D.debrisPerStrength * Math.random()));
  // Back the way the shot came (or straight out from the middle).
  const back = h.dx !== undefined && h.dy !== undefined ? Math.atan2(-h.dy, -h.dx) : Math.atan2(py + 0.5 - sprite.anchorY, px + 0.5 - sprite.anchorX);
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  const lx = (px + 0.5 - sprite.anchorX) * scale;
  const ly = (py + 0.5 - sprite.anchorY) * scale;
  for (let i = 0; i < count && chips.length < D.debrisMaxPieces; i++) {
    const size = D.debrisSize[0] + (D.debrisSize[1] - D.debrisSize[0]) * Math.min(1, h.strength * 4) * Math.random();
    const chip = cutChip(f, px + Math.round((Math.random() - 0.5) * 2), py + Math.round((Math.random() - 0.5) * 2), size);
    if (!chip) continue;
    const a = angle + back + (Math.random() - 0.5) * 2.2;
    const v = D.debrisSpeed[0] + Math.random() * (D.debrisSpeed[1] - D.debrisSpeed[0]);
    chips.push({
      sprite: chip,
      x: x + lx * c - ly * n,
      y: y + lx * n + ly * c,
      vx: Math.cos(a) * v + (s.vx ?? 0) * D.debrisMomentum,
      vy: Math.sin(a) * v + (s.vy ?? 0) * D.debrisMomentum,
      angle: angle + Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 2 * D.debrisSpin * Math.PI * 2,
      scale,
      age: 0,
      life: D.debrisLife[0] + Math.random() * (D.debrisLife[1] - D.debrisLife[0]),
    });
  }
}

/** Move and draw the debris knocked off ships (after the ships), on the game's clock; they fade at the end. */
export function drawDebrisChips(r: PixelRenderer, time: number) {
  // A new run (the clock went back): none left.
  if (time < chipsTime) chips = [];
  const dt = Math.min(0.1, Math.max(0, time - chipsTime));
  chipsTime = time;
  if (!chips.length) return;
  const keep = Math.max(0, 1 - 0.6 * dt);
  for (const k of chips) {
    k.age += dt;
    k.x += k.vx * dt;
    k.y += k.vy * dt;
    k.vx *= keep;
    k.vy *= keep;
    k.angle += k.spin * dt;
  }
  chips = chips.filter((k) => k.age < k.life);
  const mode = r.rotation;
  if (mode === 'rotsprite') r.rotation = 'grid';
  for (const k of chips) r.drawSprite(k.sprite, k.x, k.y, k.angle, 0, Math.min(1, (k.life - k.age) / 0.4), false, k.scale);
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

/** Where a hurt ship sparks and smokes from: its marks, else a couple of spots picked on its hull (offsets from the anchor, art pixels). */
function damagedSpots(m: Marks) {
  if (m.marks.length) return m.marks.map((k) => ({ ox: k.ox, oy: k.oy }));
  if (!m.spots) {
    const f = m.frame;
    m.spots = [];
    for (let i = 0; i < 2; i++) {
      const p = randomHullPixel(f);
      if (p) m.spots.push({ ox: p.px + 0.5 - m.sprite.anchorX, oy: p.py + 0.5 - m.sprite.anchorY });
    }
  }
  return m.spots;
}

/**
 * A ship's damage particles (Game.ts, with the thrusters'): smoke from strong burns; below
 * `sparksBelow` of its health, bursts of sparks from its damaged spots now and then (more often
 * the lower it is); below `smokeBelow`, steady smoke from them.
 */
export function emitDamageParticles(particles: Particles, s: Damageable & { x: number; y: number; angle: number; vx: number; vy: number }, dt: number) {
  const m = shipMarks.get(s);
  if (!m) return;
  const D = CONFIG.damage;
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  const at = (k: { ox: number; oy: number }) => {
    const ox = k.ox * m.scale;
    const oy = k.oy * m.scale;
    return { x: s.x + ox * c - oy * n, y: s.y + ox * n + oy * c };
  };
  const size = Math.sqrt(m.scale);
  const look = m.look;
  for (const k of m.smoke) {
    const p = at(k);
    particles.emit({ ...look.smoke, perSecond: look.smoke.perSecond * size * look.particles }, p.x, p.y, Math.random() * Math.PI * 2, dt, s.vx, s.vy);
  }
  const health = s.hp / s.stats.maxHp;
  if (health >= D.sparksBelow || s.hp <= 0) return;
  const spots = damagedSpots(m);
  if (!spots.length) return;
  // Sparks: bursts now and then, more often the lower its health.
  const often = D.sparkBursts * (1 - health / D.sparksBelow) * look.particles;
  if (Math.random() < often * dt) {
    const p = at(spots[Math.floor(Math.random() * spots.length)]);
    const count = D.sparkCount[0] + Math.floor(Math.random() * (D.sparkCount[1] - D.sparkCount[0] + 1));
    particles.emit({ ...look.spark, perSecond: count }, p.x, p.y, Math.random() * Math.PI * 2, 1, s.vx, s.vy);
  }
  // Smoke: steady, from its worst spots.
  if (health < D.smokeBelow)
    for (const k of spots.slice(0, D.lowSmokeSpots)) {
      const p = at(k);
      particles.emit({ ...look.smoke, perSecond: D.lowSmoke * size * look.particles }, p.x, p.y, Math.random() * Math.PI * 2, dt, s.vx, s.vy);
    }
}

/** What a Leviathan piece's marks hang on: its share of the shared health and where it was last drawn. */
type PieceDamage = Damageable & { x: number; y: number; angle: number; vx: number; vy: number };
const pieceDamage = new WeakMap<object, PieceDamage>();

/**
 * Draw a Leviathan body piece's marks (render.ts drawLeviathan; not its head): `piece` carries its
 * hits, `health` = the whole body's health (0–1), `angle` its image's x axis (its art faces up).
 */
export function drawPieceDamage(
  r: PixelRenderer,
  assets: Assets,
  piece: { hits?: DamageHit[] },
  health: number,
  sprite: Sprite,
  spot: (x: number, y: number) => { x: number; y: number },
  x: number,
  y: number,
  angle: number,
  scale: number,
  time: number,
  tilt?: DecorTilt,
) {
  let d = pieceDamage.get(piece);
  if (!d) pieceDamage.set(piece, (d = { hp: 1, stats: { maxHp: 1 }, x, y, angle, vx: 0, vy: 0 }));
  Object.assign(d, { hp: health, hits: piece.hits, x, y, angle });
  drawDamage(r, assets, d, 1, sprite, spot, x, y, angle, scale, 1, time, tilt, fleshLook());
}

/** A Leviathan's pieces' blood drops and spurts (Game.ts; as ships' smoke and sparks). */
export function emitPieceParticles(particles: Particles, pieces: object[], dt: number) {
  for (const p of pieces) {
    const d = pieceDamage.get(p);
    if (d) emitDamageParticles(particles, d, dt);
  }
}

/** Forget a ship's marks (ShipArt's Repair button). */
export function clearDamage(s: Damageable) {
  shipMarks.delete(s);
  if (s.hits) s.hits.length = 0;
}
