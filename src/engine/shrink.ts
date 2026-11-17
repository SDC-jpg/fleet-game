// Crisp shrunk copies of pixel art (for detail steps, see renderer.ts).
//
// Each pixel of the copy covers a small square of the original's pixels and
// takes the colour that covers most of it: only the art's own colours are used
// (no blending), so it stays pixel art. Ties go to the darker colour, so dark
// outlines tend to survive. A pixel is see-through only if most of its square is.
// Very thin details can still vanish: hand-drawn small versions look better
// (see docs/DETAIL-STEPS.md).

import type { Frame } from './assets';

/** Copies already made, per frame and size. */
let cache = new WeakMap<Frame, Map<number, HTMLCanvasElement>>();
/** Pixels in all copies made so far; past the limit the cache starts over (memory). */
let cachedPixels = 0;
const MAX_CACHED_PIXELS = 48_000_000;

/** A copy of frame `f` at `k` times its size (k below 1), made once and kept. */
export function shrunkFrame(f: Frame, k: number): HTMLCanvasElement {
  const key = Math.round(k * 10000);
  let sizes = cache.get(f);
  const found = sizes?.get(key);
  if (found) return found;
  const copy = shrink(f, key / 10000);
  cachedPixels += copy.width * copy.height;
  if (cachedPixels > MAX_CACHED_PIXELS) {
    cache = new WeakMap();
    cachedPixels = copy.width * copy.height;
    sizes = undefined;
  }
  if (!sizes) cache.set(f, (sizes = new Map()));
  sizes.set(key, copy);
  return copy;
}

const scratch = document.createElement('canvas');

function shrink(f: Frame, k: number): HTMLCanvasElement {
  // Read the original's pixels.
  scratch.width = f.w;
  scratch.height = f.h;
  const sctx = scratch.getContext('2d', { willReadFrequently: true })!;
  sctx.clearRect(0, 0, f.w, f.h);
  sctx.drawImage(f.image, f.sx, f.sy, f.w, f.h, 0, 0, f.w, f.h);
  const src = new Uint32Array(sctx.getImageData(0, 0, f.w, f.h).data.buffer);

  const w = Math.max(1, Math.round(f.w * k));
  const h = Math.max(1, Math.round(f.h * k));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(w, h);
  const dst = new Uint32Array(img.data.buffer);
  // Which original columns/rows each copy pixel covers (pixel centres inside its square, at least one).
  const span = (i: number, n: number, size: number) => {
    const a = Math.min(n - 1, Math.floor(((i * n) / size)));
    const b = Math.max(a + 1, Math.min(n, Math.floor((((i + 1) * n) / size))));
    return [a, b];
  };
  const counts = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    const [y0, y1] = span(y, f.h, h);
    for (let x = 0; x < w; x++) {
      const [x0, x1] = span(x, f.w, w);
      counts.clear();
      let clear = 0;
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const c = src[sy * f.w + sx];
          // Alpha is the top byte (little-endian RGBA).
          if (c >>> 24 < 128) clear++;
          else counts.set(c, (counts.get(c) ?? 0) + 1);
        }
      let opaque = 0;
      for (const n of counts.values()) opaque += n;
      if (opaque === 0 || clear > opaque) continue; // stays see-through
      let best = 0;
      let bestN = -1;
      for (const [c, n] of counts)
        if (n > bestN || (n === bestN && brightness(c) < brightness(best))) {
          best = c;
          bestN = n;
        }
      dst[y * w + x] = best;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

const brightness = (c: number) => (c & 0xff) + ((c >>> 8) & 0xff) + ((c >>> 16) & 0xff);
