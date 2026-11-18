// ShipArt: a ship image's pixels (for fitting its hit shape and noticing when its outline changes).

import type { Assets } from '../engine/assets';
import { fitHitShape, outlineFingerprint, type Pixels } from '../game/hitFit';

/** The first frame of a sprite as pixels, with its anchor (the pixel at the ship's centre). */
export function spritePixels(assets: Assets, name: string): { pixels: Pixels; anchorX: number; anchorY: number } | null {
  if (!assets.has(name)) return null;
  const s = assets.get(name);
  const f = s.frames[0];
  if (!f) return null;
  const c = document.createElement('canvas');
  c.width = f.w;
  c.height = f.h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(f.image, f.sx, f.sy, f.w, f.h, 0, 0, f.w, f.h);
  return { pixels: g.getImageData(0, 0, f.w, f.h), anchorX: s.anchorX, anchorY: s.anchorY };
}

/** A ship image's hit shape fitted to its art, and its outline's fingerprint. */
export function fitShip(assets: Assets, name: string) {
  const p = spritePixels(assets, name);
  if (!p) return null;
  return { circles: fitHitShape(p.pixels, p.anchorX, p.anchorY), art: outlineFingerprint(p.pixels) };
}

/** The fingerprint of a ship image's outline now. */
export function shipArtFingerprint(assets: Assets, name: string) {
  const p = spritePixels(assets, name);
  return p ? outlineFingerprint(p.pixels) : null;
}
