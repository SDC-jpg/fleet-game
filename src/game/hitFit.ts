// Fitting a ship's hit shape to its art (ShipArt's "Fit to art"): a few circles that cover
// most of the image's solid pixels, biggest first. Done on a small copy of the outline
// (at most FIT_SIZE pixels across), so it's quick even for the biggest ships.
// Also a fingerprint of the outline, so ShipArt can tell when the image's shape changed.

import type { HitCircle } from './artLayout';

/** Pixels at least this opaque count as the ship (0–255). */
const SOLID = 128;
/** The outline is fitted on a copy at most this many pixels across. */
const FIT_SIZE = 64;
/** Most circles in a hit shape. */
export const MAX_HIT_CIRCLES = 6;
/** Stop once this share of the ship is covered. */
const ENOUGH = 0.94;

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A short fingerprint of the image's outline (which pixels are solid). Recolouring doesn't change it. */
export function outlineFingerprint(img: Pixels): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  mix(img.width);
  mix(img.height);
  for (let i = 3; i < img.data.length; i += 4) mix(img.data[i] >= SOLID ? 1 : 0);
  return `${img.width}x${img.height}:${h.toString(16)}`;
}

/**
 * Circles covering the image's solid pixels, in the ship's pixels from its anchor (anchorX,
 * anchorY = the image pixel at the ship's centre). Empty if the image has nothing solid.
 */
export function fitHitShape(img: Pixels, anchorX: number, anchorY: number, max = MAX_HIT_CIRCLES): HitCircle[] {
  // A small copy of the outline: a cell is solid if at least 40% of its pixels are.
  const f = Math.min(1, FIT_SIZE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * f));
  const h = Math.max(1, Math.round(img.height * f));
  const solid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / f);
      const y0 = Math.floor(y / f);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) / f));
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) / f));
      let on = 0;
      let all = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++)
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          all++;
          if (img.data[(yy * img.width + xx) * 4 + 3] >= SOLID) on++;
        }
      solid[y * w + x] = all && on / all >= 0.4 ? 1 : 0;
    }
  const total = solid.reduce((a, b) => a + b, 0);
  if (!total) return [];

  // How far each solid cell is from the nearest empty one (or the edge): the biggest circle centred there.
  const depth = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!solid[y * w + x]) continue;
      let best = Math.min(x + 1, y + 1, w - x, h - y);
      const reach = Math.ceil(best);
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || solid[yy * w + xx]) continue;
          best = Math.min(best, Math.hypot(dx, dy));
        }
      depth[y * w + x] = best;
    }

  // Greedily add the circle that covers the most still-uncovered solid cells.
  const covered = new Uint8Array(w * h);
  let done = 0;
  const circles: { x: number; y: number; r: number }[] = [];
  while (circles.length < max && done / total < ENOUGH) {
    let pick: { x: number; y: number; r: number; gain: number } | null = null;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!solid[y * w + x]) continue;
        const r = depth[y * w + x] + 0.5;
        let gain = 0;
        const R = Math.ceil(r);
        for (let dy = -R; dy <= R; dy++)
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || dx * dx + dy * dy > r * r) continue;
            const i = yy * w + xx;
            if (solid[i] && !covered[i]) gain++;
          }
        if (!pick || gain > pick.gain) pick = { x, y, r, gain };
      }
    // Nothing worth adding (a speck of a few cells isn't worth a circle).
    if (!pick || pick.gain < Math.max(2, total * 0.02)) break;
    const R = Math.ceil(pick.r);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const xx = pick.x + dx;
        const yy = pick.y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || dx * dx + dy * dy > pick.r * pick.r) continue;
        const i = yy * w + xx;
        if (solid[i] && !covered[i]) {
          covered[i] = 1;
          done++;
        }
      }
    circles.push(pick);
  }

  // Back to the ship's pixels, from its anchor, rounded to half pixels.
  const half = (v: number) => Math.round(v * 2) / 2;
  return circles.map((c) => ({ x: half((c.x + 0.5) / f - anchorX), y: half((c.y + 0.5) / f - anchorY), r: Math.max(1, half(c.r / f)) }));
}
