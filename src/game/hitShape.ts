// Ship hit shapes: what shots, missiles and beams hit. A ship can have a few circles placed
// along its hull in ShipArt (art.json `hitShape`, turning with the ship), so shots respect its
// general shape (they pass between the wings). Ships without one use a single round hit circle
// (the tier's hit radius), as before. Ships bumping into each other, area effects and dead
// missiles bouncing off still use the round circle.
// Quick first test: a circle around the whole shape; only things inside it check the circles.

import type { ArtLayoutsFile, HitCircle } from './artLayout';
import { CONFIG } from './config';
import { shipArtBase, tierName } from './guns';
import type { Ship } from './world';
import { leviathanCircles } from './leviathan';

let layouts: ArtLayoutsFile | null = null;
/** Per design and tier: its circles and the radius of a circle around them all (null = round). */
const cache = new Map<string, { circles: HitCircle[]; bound: number } | null>();

/** Give the hit shapes the art layouts (Game.ts does this once art.json is loaded). */
export function setHitLayouts(data: ArtLayoutsFile | null) {
  layouts = data;
  cache.clear();
}

type HitShip = Pick<Ship, 'type' | 'team' | 'hijackedFrom' | 'tier' | 'variant' | 'x' | 'y' | 'angle' | 'stats'> & Partial<Pick<Ship, 'leviathan'>>;

function shapeOf(s: HitShip) {
  const base = shipArtBase(s);
  const key = `${base}|${s.tier}`;
  if (!cache.has(key)) {
    // Every circle a little bigger (CONFIG.hitShape.padding), so shots that graze the hull still count.
    const pad = CONFIG.hitShape.padding;
    const circles = layouts?.ships[tierName(base, s.tier)]?.hitShape?.map((c) => ({ ...c, r: c.r + pad }));
    cache.set(key, circles?.length ? { circles, bound: Math.max(...circles.map((c) => Math.hypot(c.x, c.y) + c.r)) } : null);
  }
  return cache.get(key)!;
}

/** The ship's hit circles where they are now (world positions). */
export function hitCircles(s: HitShip): HitCircle[] {
  // A Leviathan: a circle on each piece of its body.
  if (s.leviathan) return leviathanCircles(s.leviathan);
  const shape = shapeOf(s);
  if (!shape) return [{ x: s.x, y: s.y, r: s.stats.radius }];
  const cos = Math.cos(s.angle);
  const sin = Math.sin(s.angle);
  return shape.circles.map((c) => ({ x: s.x + c.x * cos - c.y * sin, y: s.y + c.x * sin + c.y * cos, r: c.r }));
}

/** Does something at (x, y), `extra` in radius (a shot's own size), touch the ship? */
export function pointHitsShip(s: HitShip, x: number, y: number, extra = 0): boolean {
  if (s.leviathan) return hitCircles(s).some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 <= (c.r + extra) ** 2);
  const shape = shapeOf(s);
  const dx = x - s.x;
  const dy = y - s.y;
  const d2 = dx * dx + dy * dy;
  if (!shape) return d2 <= (s.stats.radius + extra) ** 2;
  if (d2 > (shape.bound + extra) ** 2) return false;
  // Into the ship's own frame (facing right).
  const cos = Math.cos(s.angle);
  const sin = Math.sin(s.angle);
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return shape.circles.some((c) => (lx - c.x) ** 2 + (ly - c.y) ** 2 <= (c.r + extra) ** 2);
}

/**
 * How far along a ray (from x, y going dx, dy, a unit direction; `extra` = the ray's half width)
 * it first touches the ship: 0 if it starts inside, null if it misses (or the ship is behind).
 */
export function rayHitsShip(s: HitShip, x: number, y: number, dx: number, dy: number, extra = 0): number | null {
  const shape = s.leviathan ? null : shapeOf(s);
  const bound = (shape ? shape.bound : s.stats.radius) + extra;
  // Quick test against a circle around the whole shape.
  if (!s.leviathan && rayCircle(x, y, dx, dy, s.x, s.y, bound) === null) return null;
  let best: number | null = null;
  for (const c of hitCircles(s)) {
    const t = rayCircle(x, y, dx, dy, c.x, c.y, c.r + extra);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Where a ray first touches a circle (0 if it starts inside), or null. */
function rayCircle(x: number, y: number, dx: number, dy: number, cx: number, cy: number, r: number): number | null {
  const along = (cx - x) * dx + (cy - y) * dy;
  const side = (cx - x) * dy - (cy - y) * dx;
  if (Math.abs(side) >= r) return null;
  const half = Math.sqrt(r * r - side * side);
  if (along + half < 0) return null;
  return Math.max(0, along - half);
}
